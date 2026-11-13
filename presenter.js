// ============================================================
//   303-XMD — presenter.js
// ============================================================
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
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
    const now = Date.now();
    if (!force && now - lastScan < RESCAN_DEBOUNCE_MS) return false;
    lastScan = now;
    if (!fs.existsSync(COMMANDS_DIR)) return false;

    const sig = computeFolderSignature(COMMANDS_DIR);
    if (!force && sig === folderSignature) return false;
    folderSignature = sig;

    commandCache.clear();
    autoCache.clear();

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
                    for (const n of names) commandCache.set(n, mod);
                }

                if (hasHook && mod.toggleKey) {
                    autoCache.set(mod.name || itemPath, mod);
                }
            } catch (e) {
                console.error(`⚠️ Load ${itemPath}:`, e.message);
            }
        }
    };
    walk(COMMANDS_DIR);

    console.log(fancy(`♻️ Loaded ${commandCache.size} command(s) · ${autoCache.size} auto module(s).`));
    return true;
}
loadCommands(true);
setInterval(() => { try { loadCommands(false); } catch {} }, 3000).unref();

// ================= DEBOUNCED USER SAVES =================
const pendingUserSaves = new Map();
function scheduleUserSave(user) { pendingUserSaves.set(user.jid, user); }
setInterval(async () => {
    for (const [, user] of pendingUserSaves) { try { await user.save(); } catch {} }
    pendingUserSaves.clear();
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

// ================= BUTTON ROUTER =================
async function routeButtonInteraction(conn, msg, ctx) {
    const buttonId =
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (!buttonId) return false;
    const seen = new Set();
    for (const [, mod] of commandCache) {
        if (seen.has(mod)) continue;
        seen.add(mod);
        if (typeof mod.handleButton === 'function') {
            try {
                const handled = await mod.handleButton(conn, msg, buttonId, ctx);
                if (handled === true || handled === undefined) return true;
            } catch (e) { console.error("handleButton:", e.message); }
        }
    }
    return false;
}

// ================= MAIN HANDLER =================
module.exports = async (conn, m, userId = "default") => {
    try {
        if (!m.messages || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;

        // --- FETCH CUSTOM SETTINGS FOR THIS SESSION ---
        let customSettings = {};
        try {
            customSettings = await SessionSettings.findOne({ sessionId: userId }).lean() || {};
        } catch (e) {}

        const currentPrefix = customSettings.prefix || config.prefix;
        const currentBotName = customSettings.botName || config.botName;

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        const sender = msg.key.participant || msg.key.remoteJid;
        const pushname = msg.pushName || "Unknown";

        const body = (type === 'conversation') ? msg.message.conversation :
                    (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text :
                    (type === 'imageMessage') ? msg.message.imageMessage.caption :
                    (type === 'videoMessage') ? msg.message.videoMessage.caption : '';

        const isGroup   = from.endsWith('@g.us');
        const isChannel = from.endsWith('@newsletter');
        const isStatus  = from === 'status@broadcast';
        const isCmd     = body && body.startsWith(currentPrefix);
        const command   = isCmd ? body.slice(currentPrefix.length).trim().split(' ')[0].toLowerCase() : '';
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
            console.log(`» Chat ID: ${sender.split('@')[0]}`);
            console.log(`» Group: ${isGroup ? "YES" : "NO"}`);
            console.log(`» Group JID: ${isGroup ? from : "N/A"}`);
            console.log(`» Message: ${body ? body.slice(0, 50) : "[Media/No Text]"}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        }
        // ============================================================

        // Owner detection
        const senderBare   = String(sender).split('@')[0].split(':')[0].replace(/\D/g, '');
        const sessionJid   = conn.user?.id || '';
        const sessionBare  = sessionJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const ownerCfgBare = String(config.ownerNumber || '').replace(/\D/g, '');

        const isOwner =
            msg.key.fromMe === true ||
            (senderBare && senderBare === ownerCfgBare) ||
            (senderBare && senderBare === sessionBare);

        try { loadCommands(false); } catch {}

        const cmdCtx = {
            from, sender, fancy, isOwner, pushname, config, conn, msg,
            userId, isGroup, isChannel, isStatus, body, args, command, prefix: currentPrefix, botName: currentBotName, isCmd,
            senderBare, sessionBare, ownerCfgBare
        };

        // ============================================================
        //   CACHE EVERY INCOMING MESSAGE (for antidelete media recovery)
        // ============================================================
        if (!msg.key.fromMe && !isStatus && !isChannel) {
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

                    if (type === 'audioMessage') {
                        ptt = msg.message.audioMessage?.ptt === true;
                    }
                    if (type === 'documentMessage') {
                        fileName = msg.message.documentMessage?.fileName || 'file';
                    }

                    try {
                        const stream = await downloadContentFromMessage(msg.message[type], mediaKind);
                        const chunks = [];
                        let total = 0;
                        const MAX = 20 * 1024 * 1024;
                        for await (const c of stream) {
                            total += c.length;
                            if (total > MAX) throw new Error('Media > 20MB, not cached');
                            chunks.push(c);
                        }
                        mediaBuffer = Buffer.concat(chunks);
                    } catch (e) {
                        console.error('[cache] media download failed:', e.message);
                    }
                }

                messageStore.save(msg.key.id, {
                    key: msg.key,
                    message: msg.message,
                    type,
                    body,
                    sender,
                    pushname,
                    from,
                    isGroup,
                    userId,
                    mediaBuffer,
                    mediaMime,
                    mediaKind,
                    fileName,
                    ptt,
                    timestamp: Date.now()
                });
            } catch (e) {
                console.error('[cache] save failed:', e.message);
            }
        }

        // ============================================================
        //   AUTO ENFORCEMENT LAYER
        // ============================================================
        for (const [, mod] of autoCache) {
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
            if (isTarget) {
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

                const targets = [...(config.forwardChannelTo || [])];
                if (config.ownerNumber) targets.push(config.ownerNumber + '@s.whatsapp.net');
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
            }
            return;
        }

        if (await routeButtonInteraction(conn, msg, cmdCtx)) return;
        if (isStatus) return;

        // ============================================================
        //   PER-SESSION WORK MODE CHECK
        // ============================================================
        if (!isOwner) {
            try {
                const mongoose = require('mongoose');
                let SessionMode;
                try { SessionMode = mongoose.models.SessionMode || mongoose.model('SessionMode'); } catch (e) { SessionMode = mongoose.model('SessionMode'); }
                
                const sessionModeDoc = await SessionMode.findOne({ sessionId: userId }).lean();
                const actualMode = sessionModeDoc ? sessionModeDoc.mode : (config.workMode || 'public');
                
                if (actualMode === 'private') return;
            } catch (e) {
                if (config.workMode === 'private') return;
            }
        }

        // ============================================================
        //   MENU LISTENER FIX
        // ============================================================
        if (!isCmd && /^[0-9]$/.test((body || '').trim())) {
            return;
        }

        if (!isOwner && !isGroup && config.channelLink) {
            const subbed = await isSubscribed(sender);
            if (!subbed) {
                await ChannelSubscriber.create({
                    jid: sender, name: pushname,
                    subscribedAt: new Date(), isActive: true, autoFollow: true
                });
                subscriberCache.add(sender);
                await conn.sendMessage(from, { text: fancy(`✅ Auto-subscribed!\n\n🔗 ${config.channelLink}`) });
            }
        }

        if (config.autoSave && !isOwner && !isGroup) {
            try {
                let user = await User.findOne({ jid: sender });
                if (!user) user = new User({ jid: sender, name: pushname, sessionId: userId, lastActive: new Date(), messageCount: 1 });
                else { user.messageCount += 1; user.lastActive = new Date(); }
                scheduleUserSave(user);
            } catch {}
        }

        // ================= COMMANDS =================
        if (isCmd) {
            const handler = commandCache.get(command);
            if (handler && typeof handler.execute === 'function') {
                const t0 = Date.now();
                let success = true;
                let errorMsg = null;
                try {
                    await Promise.race([
                        handler.execute(conn, msg, args, cmdCtx),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('Command timeout')), 60000))
                    ]);
                } catch (e) {
                    success = false;
                    errorMsg = e.message;
                    console.error(`Cmd "${command}":`, e.message);
                    await conn.sendMessage(from, { text: fancy(`❌ Error: ${e.message}`) });
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
        //   AI
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

                    console.log(`[voice-ai] Transcribed: "${transcript}"`);

                    let prompt = transcript;
                    if (isGroup) {
                        humanChat.pushContext(from, pushname || sender.split("@")[0], transcript);
                        const context = humanChat.getContext(from, 15);
                        if (context) prompt = `You are chatting in a WhatsApp group. Recent messages:\n\n${context}\n\nReply naturally to the latest message. Short and casual. Match the language.`;
                    }

                    const reply = await aiChat.askAI(prompt, userId, null);

                    if (reply) {
                        const finalReply = isGroup ? humanChat.humanize(reply) : reply;
                        const audioBuffer = await aiChat.textToSpeech(finalReply);
                        
                        if (audioBuffer) {
                            await conn.sendMessage(from, { 
                                audio: audioBuffer, 
                                mimetype: 'audio/mp4', 
                                ptt: true 
                            }, { quoted: msg });
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
                    aiVision.setSessionImage(from, buffer, "image/jpeg");
                    if (config.autoTyping) { try { await conn.sendPresenceUpdate('composing', from); } catch {} }
                    const delay = isGroup ? 900 + Math.floor(Math.random() * 800) : 500;
                    await new Promise(r => setTimeout(r, delay));
                    const caption = (msg.message.imageMessage?.caption || "").trim();
                    
                    const reply = await aiVision.describePhoto(buffer, "image/jpeg", caption, null);
                    
                    if (reply) await conn.sendMessage(from, { text: reply }, { quoted: msg });
                } catch (e) { console.error("[vision] photo error:", e.message); }
                return;
            }

            if (type === "conversation" || type === "extendedTextMessage") {
                if (!body || !body.trim()) return;
                if (humanChat.hasReplied(msg.key.id)) return;
                
                // ============================================================
                //   AUTOMATIC BIBLE DETECTION
                // ============================================================
                let finalPrompt = body;
                const bibleRegex = /\b(1|2|3)?\s?(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs?|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s?\d+:\d+(-\d+)?\b/i;
                
                const bibleMatch = body.match(bibleRegex);
                
                if (bibleMatch) {
                    try {
                        const reference = bibleMatch[0];
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
                // ============================================================

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
                            humanChat.pushContext(from, pushname || sender.split("@")[0], body);
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
module.exports.handleGroupUpdate = async (conn, update) => {
    try {
        const { id: groupJid, participants, action } = update;
        for (const [, mod] of autoCache) {
            if (!mod.toggleKey) continue;
            try {
                const on = await autoToggles.get("default", mod.toggleKey, groupJid, false);
                if (!on) continue;
            } catch { continue; }
            if (action === 'add' && typeof mod.onGroupJoin === 'function') {
                await mod.onGroupJoin(conn, groupJid, participants);
            } else if (action === 'remove' && typeof mod.onGroupLeave === 'function') {
                await mod.onGroupLeave(conn, groupJid, participants);
            }
        }
    } catch (e) { console.error("group update:", e.message); }
};

module.exports.handleCallEvent = async (conn, calls) => {
    for (const [, mod] of autoCache) {
        if (!mod.toggleKey) continue;
        if (typeof mod.onCall === 'function') {
            try { await mod.onCall(conn, calls); } catch (e) { console.error(`auto/${mod.name}:`, e.message); }
        }
    }
};

// ================= EXPOSE =================
module.exports.getCommandCache = () => commandCache;
module.exports.getAutoCache    = () => autoCache;
module.exports.reloadCommands  = () => loadCommands(true);