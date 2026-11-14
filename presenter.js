// ============================================================
//   303-XMD — presenter.js (BULLETPROOF OWNER & COMMAND FIX)
// ============================================================
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const config = require('./config');
const { fancy } = require('./lib/font');
const { User, ChannelSubscriber, ChannelPost, SessionSettings } = require('./database/models'); 
const messageStore = require('./lib/messageStore');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const analytics = require('./lib/analytics');
const aiChat = require('./lib/aiChat');
const aiVision = require('./lib/aiVision');

// Safe imports
let aiSettings;
try { aiSettings = require('./lib/aiSettings'); } catch (_) {
    aiSettings = {
        isEnabledCached: () => config.aiChatEnabled !== false,
        isGroupsEnabledCached: () => config.aiGroups !== false,
        getStatus: async () => ({ enabled: true, groupsEnabled: true, source: 'config' }),
        setAiEnabled: async () => {},
        setAiGroupsEnabled: async () => {},
        refreshCache: async () => {}
    };
}

let humanChat;
try { humanChat = require('./lib/humanChat'); } catch (_) {
    humanChat = {
        pushContext: () => {}, getContext: () => '', clearContext: () => {},
        hasReplied: () => false, humanize: (t) => t
    };
}

let autoToggles;
try { autoToggles = require('./lib/autoToggles'); } catch (_) {
    autoToggles = { get: async () => false, set: async () => {}, getAll: async () => ({}), clearCache: () => {} };
}

// ================= HOT-RELOAD COMMAND LOADER =================
const COMMANDS_DIR = path.join(__dirname, 'commands');
const commandCache = new Map();
const autoCache = new Map();
let folderSignature = '';
let lastScan = 0;
let isLoading = false;
const RESCAN_DEBOUNCE_MS = 2000;

function computeFolderSignature(dir) {
    if (!fs.existsSync(dir)) return '';
    const parts = [];
    const walk = (d) => {
        for (const item of fs.readdirSync(d)) {
            const full = path.join(d, item);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) walk(full);
            else if (item.endsWith('.js')) parts.push(`${item}:${stat.mtimeMs}`);
        }
    };
    walk(dir);
    return parts.sort().join('|');
}

function loadCommands(force = false) {
    if (isLoading) return false;
    const now = Date.now();
    if (!force && now - lastScan < RESCAN_DEBOUNCE_MS) return false;
    lastScan = now;
    if (!fs.existsSync(COMMANDS_DIR)) return false;

    const sig = computeFolderSignature(COMMANDS_DIR);
    if (!force && sig === folderSignature) return false;

    isLoading = true;
    try {
        folderSignature = sig;
        const newCommandCache = new Map();
        const newAutoCache = new Map();

        const walk = (dir) => {
            for (const item of fs.readdirSync(dir)) {
                const itemPath = path.join(dir, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) { walk(itemPath); continue; }
                if (!item.endsWith('.js')) continue;

                try {
                    delete require.cache[require.resolve(itemPath)];
                    const mod = require(itemPath);
                    if (!mod) continue;

                    const hasExecute = typeof mod.execute === 'function';
                    const hasHook = typeof mod.onMessage === 'function' ||
                                    typeof mod.onCall === 'function' ||
                                    typeof mod.onGroupJoin === 'function' ||
                                    typeof mod.onGroupLeave === 'function';

                    if (hasExecute) {
                        const names = [mod.name, ...(Array.isArray(mod.aliases) ? mod.aliases : [])]
                            .filter(Boolean).map(s => String(s).toLowerCase());
                        for (const n of names) newCommandCache.set(n, mod);
                    }

                    if (hasHook && mod.toggleKey) {
                        newAutoCache.set(mod.name || itemPath, mod);
                    }
                } catch (e) {
                    console.error(`⚠️ Load ${itemPath}:`, e.message);
                }
            }
        };
        walk(COMMANDS_DIR);

        commandCache.clear();
        for (const [k, v] of newCommandCache) commandCache.set(k, v);
        autoCache.clear();
        for (const [k, v] of newAutoCache) autoCache.set(k, v);

        console.log(fancy(`♻️ Loaded ${commandCache.size} command(s) · ${autoCache.size} auto module(s).`));
        return true;
    } finally {
        isLoading = false;
    }
}

loadCommands(true);
setInterval(() => { try { loadCommands(false); } catch (e) { /* swallow */ } }, 3000).unref();

// ================= DEBOUNCED USER SAVES =================
const pendingUserOps = new Map();

function scheduleUserActivity({ jid, name, sessionId }) {
    const cur = pendingUserOps.get(jid) || { inc: 0, name, sessionId };
    cur.inc += 1;
    cur.lastActive = new Date();
    cur.name = name || cur.name;
    cur.sessionId = sessionId || cur.sessionId;
    pendingUserOps.set(jid, cur);
}

setInterval(async () => {
    if (pendingUserOps.size === 0) return;
    const snapshot = new Map(pendingUserOps);
    pendingUserOps.clear();
    for (const [jid, op] of snapshot) {
        try {
            await User.updateOne(
                { jid },
                {
                    $inc: { messageCount: op.inc },
                    $set: { lastActive: op.lastActive, name: op.name, sessionId: op.sessionId },
                    $setOnInsert: { jid, createdAt: new Date() }
                },
                { upsert: true }
            );
        } catch (e) { console.error('[user save]', jid, e.message); }
    }
}, 30000).unref();

// ================= SUBSCRIBER CACHE =================
const subscriberCache = new Set();
let subscriberCacheLastRefresh = 0;

async function isSubscribed(jid) {
    if (Date.now() - subscriberCacheLastRefresh > 10 * 60 * 1000) {
        subscriberCache.clear();
        subscriberCacheLastRefresh = Date.now();
    }
    if (subscriberCache.has(jid)) return true;
    const sub = await ChannelSubscriber.findOne({ jid, isActive: true });
    if (sub) subscriberCache.add(jid);
    return !!sub;
}

async function ensureSubscribed(jid, pushname) {
    try {
        await ChannelSubscriber.updateOne(
            { jid },
            {
                $set: { isActive: true, name: pushname || 'Unknown', autoFollow: true },
                $setOnInsert: { jid, subscribedAt: new Date() }
            },
            { upsert: true }
        );
        subscriberCache.add(jid);
    } catch (e) { console.error('[subscribe]', jid, e.message); }
}

// ================= BUTTON ROUTER =================
async function routeButtonInteraction(conn, msg, ctx) {
    const buttonId =
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (!buttonId) return false;

    const snapshot = [...commandCache.values()];
    const seen = new Set();
    for (const mod of snapshot) {
        if (seen.has(mod)) continue;
        seen.add(mod);
        if (typeof mod.handleButton === 'function') {
            try {
                const handled = await mod.handleButton(conn, msg, buttonId, ctx);
                if (handled === true) return true;
            } catch (e) { console.error("handleButton:", e.message); }
        }
    }
    return false;
}

// ================= HELPERS =================
function bareJid(s) {
    return String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function getSessionMode(sessionId) {
    try {
        let SessionMode;
        try {
            SessionMode = mongoose.models.SessionMode || mongoose.model('SessionMode');
        } catch (_) {
            SessionMode = mongoose.model('SessionMode');
        }
        const doc = await SessionMode.findOne({ sessionId }).lean();
        return doc ? doc.mode : (config.workMode || 'public');
    } catch (e) {
        return config.workMode === 'private' ? 'private' : (config.workMode || 'public');
    }
}

// ================= MAIN HANDLER =================
module.exports = async (conn, m, userId = "default") => {
    try {
        if (!m.messages || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;

        let customSettings = {};
        try {
            customSettings = await SessionSettings.findOne({ sessionId: userId }).lean() || {};
        } catch (e) {}

        // FIX: Clean the prefix to ensure no hidden spaces break the command check
        const rawPrefix = customSettings.prefix ?? config.prefix;
        const currentPrefix = typeof rawPrefix === 'string' ? rawPrefix.trim() : ".";
        
        const currentBotName = customSettings.botName || config.botName;

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        const sender = msg.key.participant || msg.key.remoteJid;
        const pushname = msg.pushName || "Unknown";

        // FIX: Trim the body to prevent hidden newlines from breaking the command
        const rawBody = (type === 'conversation') ? msg.message.conversation :
                    (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text :
                    (type === 'imageMessage') ? msg.message.imageMessage?.caption :
                    (type === 'videoMessage') ? msg.message.videoMessage?.caption : '';
        const body = typeof rawBody === 'string' ? rawBody.trim() : '';

        const isGroup   = from.endsWith('@g.us');
        const isChannel = from.endsWith('@newsletter');
        const isStatus  = from === 'status@broadcast';
        const isCmd     = body && currentPrefix.length > 0 && body.startsWith(currentPrefix);
        const command   = isCmd ? body.slice(currentPrefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
        const args      = body ? body.trim().split(/ +/).slice(1) : [];

        // ============================================================
        // 🖨️ CONSOLE LOGGER
        // ============================================================
        if (process.env.LOG_LEVEL !== "silent") {
            const date = new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' });
            console.log(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
            console.log(`┃ 🟢 303-XMD                   ┃`);
            console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
            console.log(`» Sent Time: ${date}`);
            console.log(`» Message Type: ${type}`);
            console.log(`» Sender Name: ${pushname}`);
            console.log(`» Chat ID: ${String(sender).split('@')[0]}`);
            console.log(`» Group: ${isGroup ? "YES" : "NO"}`);
            console.log(`» Group JID: ${isGroup ? from : "N/A"}`);
            console.log(`» Message: ${body ? body.slice(0, 50) : "[Media/No Text]"}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        }

        // ============================================================
        //   BULLETPROOF OWNER DETECTION (Multi-User & LID Supported)
        // ============================================================
        const senderBare     = bareJid(sender);
        const sessionJid     = conn.user?.id || '';
        const sessionLid     = conn.user?.lid || ''; 
        const sessionBare    = bareJid(sessionJid);
        const sessionLidBare = bareJid(sessionLid);
        const ownerCfgBare   = bareJid(config.ownerNumber);

        const isOwner =
            msg.key.fromMe === true ||                                     
            (senderBare && ownerCfgBare && senderBare === ownerCfgBare) || 
            (senderBare && sessionBare && senderBare === sessionBare) ||   
            (senderBare && sessionLidBare && senderBare === sessionLidBare) ||
            (senderBare && senderBare.includes(ownerCfgBare)) ||
            (senderBare && senderBare.includes(sessionBare)); 

        // ============================================================
        // 🛡️ GROUP ADMIN DETECTION
        // ============================================================
        let isGroupAdmin = false;
        if (isGroup) {
            try {
                const meta = await conn.groupMetadata(from);
                const participant = meta.participants.find(p => {
                    const pid = String(p.id || '');
                    return pid === sender || bareJid(pid) === senderBare;
                });
                isGroupAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            } catch (e) {}
        }

        try { loadCommands(false); } catch {}

        const cmdCtx = {
            from, sender, fancy, isOwner, isGroupAdmin, pushname, config, conn, msg,
            userId, isGroup, isChannel, isStatus, body, args, command,
            prefix: currentPrefix, botName: currentBotName, isCmd,
            senderBare, sessionBare, ownerCfgBare
        };

        // ============================================================
        //   CACHE EVERY INCOMING MESSAGE
        // ============================================================
        if (!msg.key.fromMe && !isChannel) {
            try {
                let mediaBuffer = null;
                let mediaMime = null;
                let mediaKind = null;
                let fileName = null;
                let ptt = false;

                const mediaTypes = {
                    imageMessage:    { kind: 'image',    mime: msg.message.imageMessage?.mimetype },
                    videoMessage:    { kind: 'video',    mime: msg.message.videoMessage?.mimetype },
                    audioMessage:    { kind: 'audio',    mime: msg.message.audioMessage?.mimetype },
                    stickerMessage:  { kind: 'sticker',  mime: 'image/webp' },
                    documentMessage: { kind: 'document', mime: msg.message.documentMessage?.mimetype }
                };

                if (mediaTypes[type]) {
                    const info = mediaTypes[type];
                    mediaKind = info.kind;
                    mediaMime = info.mime || 'application/octet-stream';

                    if (type === 'audioMessage') ptt = msg.message.audioMessage?.ptt === true;
                    if (type === 'documentMessage') fileName = msg.message.documentMessage?.fileName || 'file';

                    try {
                        const stream = await downloadContentFromMessage(msg.message[type], mediaKind);
                        const chunks = [];
                        let total = 0;
                        const MAX = 50 * 1024 * 1024; 
                        for await (const c of stream) {
                            total += c.length;
                            if (total > MAX) throw new Error('Media > 50MB, not cached');
                            chunks.push(c);
                        }
                        mediaBuffer = Buffer.concat(chunks);
                    } catch (e) {
                        console.error('[cache] media download failed:', e.message);
                    }
                }

                messageStore.save(msg.key.id, {
                    key: msg.key, message: msg.message, type, body, sender, pushname, from,
                    isGroup, userId, mediaBuffer, mediaMime, mediaKind, fileName, ptt, timestamp: Date.now()
                });
            } catch (e) {
                console.error('[cache] save failed:', e.message);
            }
        }

        // ============================================================
        //   STATUS & STATUS REVOKE HANDLING
        // ============================================================
        if (isStatus) {
            const botJid = conn.user?.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            const isRevoke = !!msg.message?.protocolMessage;
            const targetId = isRevoke ? msg.message?.protocolMessage?.key?.id : msg.key.id;
            
            const isMyOwnStatus = (senderBare === sessionBare || senderBare === sessionLidBare);
            
            if (!isMyOwnStatus || isRevoke) {
                try {
                    const cached = messageStore.get(targetId);
                    if (cached) {
                        const senderName = cached.pushname || "Unknown";
                        const alertType = isRevoke ? "🗑️ *Status Deleted Alert*" : "📱 *New Status Alert*";
                        const prefixText = `${alertType}\n\n👤 *Sender:* ${senderName} (+${senderBare})\n\n`;
                        
                        if (cached.mediaBuffer && cached.mediaKind) {
                            const buf = cached.mediaBuffer;
                            const mime = cached.mediaMime || 'application/octet-stream';
                            const caption = cached.body ? `${prefixText}${cached.body}` : prefixText.trim();
                            
                            let content;
                            if (cached.mediaKind === 'image') content = { image: buf, mimetype: mime, caption };
                            else if (cached.mediaKind === 'video') content = { video: buf, mimetype: mime, caption };
                            else if (cached.mediaKind === 'audio') {
                                content = { audio: buf, mimetype: mime, ptt: cached.ptt === true };
                                await conn.sendMessage(botJid, { text: prefixText });
                            }
                            else content = { text: caption };
                            
                            await conn.sendMessage(botJid, content);
                        } else if (cached.body) {
                            await conn.sendMessage(botJid, { text: `${prefixText}${cached.body}` });
                        }
                    }
                } catch (e) { console.error('[Status Forward] error:', e.message); }
            }
            return; 
        }

        // ============================================================
        //   AUTO ENFORCEMENT LAYER
        // ============================================================
        const autoSnapshot = [...autoCache.values()];
        for (const mod of autoSnapshot) {
            if (typeof mod.onMessage !== 'function') continue;

            if (mod.toggleKey && mod.name !== 'antimedia') {
                let on = false;
                try {
                    on = await autoToggles.get(userId, mod.toggleKey, isGroup ? from : null, false);
                } catch (e) {
                    console.error(`[auto] toggle check failed for ${mod.name}:`, e.message);
                    continue;
                }
                if (!on) continue;
            }

            try {
                const r = await mod.onMessage(conn, msg, cmdCtx);
                if (r === true) return;
            } catch (e) {
                console.error(`auto/${mod.name}:`, e.message);
            }
        }

        // ================= CHANNEL / NEWSLETTER =================
        if (isChannel) {
            const isTarget = config.newsletterJid && from === config.newsletterJid;
            if (!isTarget) return;
            if (msg.key.fromMe) return;

            const postText =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption || '';

            if (config.logChannelPosts) {
                try {
                    await ChannelPost.create({
                        msgId: msg.key.id, serverId: msg.key.server_id, jid: from,
                        text: postText, type,
                        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
                        raw: msg
                    });
                } catch (e) { console.error("ChannelPost log:", e.message); }
            }

            if (config.autoReactChannel) {
                try {
                    let emoji = null;
                    const lower = (postText || '').toLowerCase();
                    for (const [word, react] of Object.entries(config.channelKeywordReactions || {})) {
                        if (lower.includes(word)) { emoji = react; break; }
                    }
                    if (!emoji && config.channelEmojis?.length) {
                        emoji = config.channelEmojis[Math.floor(Math.random() * config.channelEmojis.length)];
                    }
                    await conn.sendMessage(from, { react: { text: emoji || '🔥', key: msg.key } });
                } catch (e) { console.error("Channel react:", e.message); }
            }

            const targets = new Set(config.forwardChannelTo || []);
            if (config.ownerNumber) targets.add(config.ownerNumber + '@s.whatsapp.net');
            for (const t of targets) {
                try {
                    const jid = t.includes('@') ? t : t.replace(/\D/g, '') + '@s.whatsapp.net';
                    await conn.sendMessage(jid, { forward: msg, force: true });
                } catch (e) { console.error(`Forward → ${t}:`, e.message); }
            }

            if (config.crossPostWebhook) {
                try {
                    await axios.post(config.crossPostWebhook, {
                        text: postText || '[media post]',
                        channel: from,
                        timestamp: msg.messageTimestamp
                    }, { timeout: 8000 });
                } catch (e) { console.error("Cross-post:", e.message); }
            }
            return;
        }

        if (await routeButtonInteraction(conn, msg, cmdCtx)) return;
        
        if (!isOwner) {
            const actualMode = await getSessionMode(userId);
            if (actualMode === 'private') return;
        }

        if (!isCmd && /^[0-9]$/.test((body || '').trim())) {
            return;
        }

        if (!isOwner && !isGroup && config.channelLink) {
            const subbed = await isSubscribed(sender);
            if (!subbed) {
                await ensureSubscribed(sender, pushname);
                await conn.sendMessage(from, { text: fancy(`✅ Auto-subscribed!\n\n🔗 ${config.channelLink}`) });
            }
        }

        if (config.autoSave && !isOwner && !isGroup) {
            scheduleUserActivity({ jid: sender, name: pushname, sessionId: userId });
        }

        // ================= COMMANDS =================
        if (isCmd) {
            const handler = commandCache.get(command);
            if (handler && typeof handler.execute === 'function') {
                const t0 = Date.now();
                let success = true;
                let errorMsg = null;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);
                try {
                    await handler.execute(conn, msg, args, { ...cmdCtx, signal: controller.signal });
                } catch (e) {
                    success = false;
                    errorMsg = e.name === 'AbortError' ? 'Command timeout' : e.message;
                    console.error(`Cmd "${command}":`, errorMsg);
                    try {
                        await conn.sendMessage(from, { text: fancy(`❌ Error: ${errorMsg}`) });
                    } catch (_) {}
                } finally {
                    clearTimeout(timeoutId);
                }

                try {
                    await analytics.recordCommand({
                        sessionId: userId, accountId: null, command, sender, isGroup,
                        success, errorMsg, durationMs: Date.now() - t0
                    });
                } catch {}
            }
        }

        // ============================================================
        //   AI (Only for non-commands and non-owners)
        // ============================================================
        else if (!isCmd && !isOwner) {
            const aiOn     = aiSettings.isEnabledCached();
            const groupsOn = aiSettings.isGroupsEnabledCached();
            if (!aiOn) return;
            if (isGroup && !groupsOn) return;

            // ---------- VOICE NOTE AI ----------
            if (type === "audioMessage" && msg.message.audioMessage?.ptt) {
                try {
                    if (config.autoTyping) { try { await conn.sendPresenceUpdate('recording', from); } catch {} }

                    const stream = await downloadContentFromMessage(msg.message.audioMessage, "audio");
                    const chunks = [];
                    let total = 0;
                    for await (const c of stream) {
                        total += c.length;
                        if (total > 5 * 1024 * 1024) throw new Error("Audio > 5MB");
                        chunks.push(c);
                    }
                    const buffer = Buffer.concat(chunks);

                    const transcript = await aiChat.transcribeAudio(buffer);
                    if (!transcript) throw new Error("Could not understand audio");

                    let prompt = transcript;
                    if (isGroup) {
                        humanChat.pushContext(from, pushname || String(sender).split("@")[0], transcript);
                        const context = humanChat.getContext(from, 15);
                        if (context) prompt = `You are chatting in a WhatsApp group. Recent messages:\n\n${context}\n\nReply naturally to the latest message. Short and casual. Match the language.`;
                    }

                    const reply = await aiChat.askAI(prompt, userId, null);

                    if (reply) {
                        const finalReply = isGroup ? humanChat.humanize(reply) : reply;
                        const audioBuffer = await aiChat.textToSpeech(finalReply);

                        if (audioBuffer) {
                            await conn.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
                        } else {
                            await conn.sendMessage(from, { text: finalReply }, { quoted: msg });
                        }
                    }
                } catch (e) {
                    console.error("[voice-ai] error:", e.message);
                }
                return;
            }

            if (type === "imageMessage") {
                try {
                    const caption = (msg.message.imageMessage?.caption || "").trim();
                    const replied = msg.message.imageMessage?.contextInfo?.quotedMessage;
                    const repliedToBot = !!(replied && msg.message.imageMessage?.contextInfo?.participant &&
                        bareJid(msg.message.imageMessage.contextInfo.participant) === sessionBare);

                    if (!caption && !repliedToBot) return; 

                    const stream = await downloadContentFromMessage(msg.message.imageMessage, "image");
                    const chunks = [];
                    let total = 0;
                    const MAX = 5 * 1024 * 1024;
                    for await (const c of stream) {
                        total += c.length;
                        if (total > MAX) throw new Error("Image > 5MB");
                        chunks.push(c);
                    }
                    const buffer = Buffer.concat(chunks);

                    const mime = msg.message.imageMessage?.mimetype || "image/jpeg";
                    aiVision.setSessionImage(from, buffer, mime);

                    if (config.autoTyping) { try { await conn.sendPresenceUpdate('composing', from); } catch {} }
                    const delay = isGroup ? 900 + Math.floor(Math.random() * 800) : 500;
                    await new Promise(r => setTimeout(r, delay));

                    const reply = await aiVision.describePhoto(buffer, mime, caption, null);
                    if (reply) await conn.sendMessage(from, { text: reply }, { quoted: msg });
                } catch (e) { console.error("[vision] photo error:", e.message); }
                return;
            }

            if (type === "conversation" || type === "extendedTextMessage") {
                if (!body || !body.trim()) return;
                if (humanChat.hasReplied(msg.key.id)) return;
                
                let finalPrompt = body;
                const bibleRegex = /\b(?:(?:1|2|3)\s?)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2)\s?Samuel|(?:1|2)\s?Kings|(?:1|2)\s?Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs?|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2)\s?Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2)\s?Thessalonians|(?:1|2)\s?Timothy|Titus|Philemon|Hebrews|James|(?:1|2)\s?Peter|Jude|Revelation)\s+\d+:\d+(?:-\d+)?\b/i;

                const bibleMatch = body.match(bibleRegex);

                if (bibleMatch) {
                    try {
                        const reference = bibleMatch[0].replace(/\s+/g, ' ').trim();
                        const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}?translation=niv`;
                        const bibleRes = await axios.get(apiUrl);

                        if (bibleRes.data && bibleRes.data.text) {
                            finalPrompt = `The user mentioned the Bible verse "${reference}".
Here is the exact text from the ${bibleRes.data.translation_name}:
"${bibleRes.data.text.trim()}"

User's original message: ${body}
Instruction: Acknowledge their verse and respond naturally using the exact text provided above. Keep it casual.`;
                        }
                    } catch (err) {
                        console.error("[Bible Auto-Fetch] API error:", err.message);
                    }
                }

                const stored = aiVision.getSessionImage(from);
                if (config.autoTyping) { try { await conn.sendPresenceUpdate('composing', from); } catch {} }
                const delay = isGroup ? 800 + Math.floor(Math.random() * 700) : 300;
                await new Promise(r => setTimeout(r, delay));
                try {
                    let reply;
                    if (stored && stored.buffer) {
                        reply = await aiVision.answerAboutPhoto(stored.buffer, stored.mime, finalPrompt, null);
                        aiVision.setSessionImage(from, stored.buffer, stored.mime);
                    } else {
                        let prompt = finalPrompt;
                        if (isGroup) {
                            humanChat.pushContext(from, pushname || String(sender).split("@")[0], body);
                            const context = humanChat.getContext(from, 15);
                            if (context) {
                                prompt = `You are chatting in a WhatsApp group. Recent messages:\n\n${context}\n\n${finalPrompt}\n\nReply naturally. Short and casual. Match the language.`;
                            }
                        }
                        reply = await aiChat.askAI(prompt, userId, null);
                    }
                    if (reply) {
                        if (isGroup) reply = humanChat.humanize(reply);
                        const opts = isGroup && Math.random() < 0.4 ? { quoted: msg } : {};
                        await conn.sendMessage(from, { text: reply }, opts);
                    }
                } catch (e) { console.error("aiChat reply error:", e.message); }
            }
        }

    } catch (err) {
        console.error("Handler Error:", err.message);
    }
};

// ============================================================
//   GROUP / CALL EVENT HOOKS
// ============================================================
module.exports.handleGroupUpdate = async (conn, update, sessionId = "default") => {
    try {
        const { id: groupJid, participants, action } = update;
        const snapshot = [...autoCache.values()];
        for (const mod of snapshot) {
            if (!mod.toggleKey) continue;
            try {
                const on = await autoToggles.get(sessionId, mod.toggleKey, groupJid, false);
                if (!on) continue;
            } catch { continue; }
            try {
                if (action === 'add' && typeof mod.onGroupJoin === 'function') {
                    await mod.onGroupJoin(conn, groupJid, participants);
                } else if (action === 'remove' && typeof mod.onGroupLeave === 'function') {
                    await mod.onGroupLeave(conn, groupJid, participants);
                }
            } catch (e) {
                console.error(`auto/${mod.name} (group ${action}):`, e.message);
            }
        }
    } catch (e) { console.error("group update:", e.message); }
};

module.exports.handleCallEvent = async (conn, calls, sessionId = "default") => {
    const snapshot = [...autoCache.values()];
    for (const mod of snapshot) {
        if (!mod.toggleKey) continue;
        if (typeof mod.onCall !== 'function') continue;
        try {
            const on = await autoToggles.get(sessionId, mod.toggleKey, null, false);
            if (!on) continue;
        } catch (e) {
            console.error(`[auto] toggle check failed for ${mod.name}:`, e.message);
            continue;
        }
        try { await mod.onCall(conn, calls); } catch (e) { console.error(`auto/${mod.name}:`, e.message); }
    }
};

// ================= EXPOSE =================
module.exports.getCommandCache = () => commandCache;
module.exports.getAutoCache    = () => autoCache;
module.exports.reloadCommands  = async () => loadCommands(true);