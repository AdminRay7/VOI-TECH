// presenter.js — self-loading, dependency-injected, multi-user-safe command handler
const fs   = require("fs");
const path = require("path");
const { fancy } = require("./lib/font");

const commandCache = new Map();
const commandOwners = new Map();
let cacheLoaded = false;
let commandDir = null;      // absolute, resolved
let commandDirRaw = null;   // as passed in (kept for logging)
let loadInFlight = null;
let loadInFlightDir = null; // FIX #8: track which dir the in-flight load is for

// FIX #19: bounded spam tracker with periodic cleanup
const spamTracker = new Map();
const SPAM_WINDOW_MS = 5000;
const SPAM_MAX_HITS = 5;
const SPAM_TRACKER_TTL = 10 * 60 * 1000; // 10 min
let spamCleanupTimer = null;

function ensureSpamCleanup() {
    if (spamCleanupTimer) return;
    spamCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of spamTracker) {
            const times = entry?.times || [];
            if (!times.length || now - times[times.length - 1] > SPAM_TRACKER_TTL) {
                spamTracker.delete(key);
            }
        }
    }, 60 * 1000);
    if (typeof spamCleanupTimer.unref === "function") spamCleanupTimer.unref();
}
ensureSpamCleanup();

// FIX #18: allow disposal for tests / multi-tenant teardown
function dispose() {
    if (spamCleanupTimer) {
        try { clearInterval(spamCleanupTimer); } catch {}
        spamCleanupTimer = null;
    }
    spamTracker.clear();
}

/**
 * FIX #10: normalizeNumber must preserve LID vs PN distinction.
 * Returns { num, domain, isLid, raw } so callers can compare correctly.
 */
function parseJid(input) {
    if (input == null) return { num: "", domain: "", isLid: false, raw: "" };
    const raw = String(input);
    const [numPartRaw, domainRaw = ""] = raw.split("@");
    const numPart = numPartRaw.split(":")[0]; // strip device suffix
    const num = numPart.replace(/\D/g, "");
    const domain = domainRaw.toLowerCase();
    return {
        num,
        domain,
        isLid: domain === "lid",
        raw,
    };
}

// Back-compat helper — returns just the bare number string
function normalizeNumber(input) {
    return parseJid(input).num;
}

/**
 * FIX #10: compare two JIDs safely, aware of LID vs PN.
 * Returns true only if they refer to the same user under the same domain,
 * OR if both are bare numbers (legacy paths).
 */
function jidEquals(a, b) {
    const A = parseJid(a);
    const B = parseJid(b);
    if (!A.num || !B.num) return false;
    if (A.num !== B.num) return false;
    // Same number: if both have a domain, require domains to match (LID ≠ PN)
    if (A.domain && B.domain) return A.domain === B.domain;
    // Missing domain on one side → be permissive (legacy callers)
    return true;
}

// FIX #14: safe bot id derivation
function getBotId(conn) {
    const raw = conn?.user?.id;
    if (!raw) return "";
    const { num, domain } = parseJid(raw);
    if (!num) return "";
    // Preserve the domain (s.whatsapp.net vs lid) so comparisons stay correct
    return domain ? `${num}@${domain}` : `${num}@s.whatsapp.net`;
}

function loadCommands(dir) {
    if (cacheLoaded) return commandCache;
    if (!dir) throw new Error("loadCommands: dir required");

    commandDirRaw = dir;
    commandDir = path.resolve(dir); // FIX #8: always absolute

    if (!fs.existsSync(commandDir)) {
        console.warn(`⚠️ Command dir not found: ${commandDirRaw}`);
        cacheLoaded = true;
        return commandCache;
    }

    const walk = (current) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (e) {
            console.warn(`⚠️ Cannot read dir ${current}: ${e.message}`);
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.name.startsWith(".")) continue;
            if (entry.name === "node_modules") continue;
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
            registerCommand(full);
        }
    };

    walk(commandDir);
    cacheLoaded = true;
    console.log(`✅ Loaded ${commandCache.size} command name(s)`);
    return commandCache;
}

function registerCommand(filePath) {
    let mod;
    try {
        // FIX #10 (orig): log require failures instead of silently swallowing
        delete require.cache[require.resolve(filePath)];
        mod = require(filePath);
    } catch (e) {
        console.warn(`⚠️ Failed to load command ${filePath}: ${e?.message || e}`);
        return;
    }

    if (!mod || typeof mod.execute !== "function") return;

    const names = [
        mod.name,
        ...(Array.isArray(mod.aliases) ? mod.aliases : [])
    ].filter(Boolean).map(n => String(n).toLowerCase().trim()).filter(Boolean);

    if (names.length === 0) return;

    // FIX #6: reject the entire module if ANY of its names collides with a
    // different existing file. This keeps the name→module map consistent
    // (previously some names mapped to A, others to B after a partial overlap).
    for (const name of names) {
        const existing = commandOwners.get(name);
        if (existing && existing !== filePath) {
            console.warn(
                `⚠️ Command "${name}" from ${filePath} collides with ${existing} — skipping entire module`
            );
            return;
        }
    }

    for (const name of names) {
        commandCache.set(name, mod);
        commandOwners.set(name, filePath);
    }
}

function reloadCommands() {
    // FIX #4: use resolved absolute dir so require.cache keys match, and
    // reload from `commandDir` (not the raw, possibly-relative path).
    if (commandDir) {
        const prefix = commandDir + path.sep;
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(prefix) && key.endsWith(".js")) {
                try { delete require.cache[key]; } catch {}
            }
        }
    }
    commandCache.clear();
    commandOwners.clear();
    cacheLoaded = false;
    loadInFlight = null;
    loadInFlightDir = null;
    // FIX #4: reset spam windows so a stale ban doesn't survive reload
    spamTracker.clear();

    if (commandDir) loadCommands(commandDir);
    else if (commandDirRaw) loadCommands(commandDirRaw);
    return commandCache;
}

async function handler(conn, m, options = {}) {
    const {
        userId = "default",
        config = {},
        helpers = {},
        services = {},
        commandsDir = null,
    } = options;

    // FIX #9 + #8: per-directory in-flight tracker so concurrent handlers
    // with different commandsDir don't clobber each other. Reset on failure.
    if (!cacheLoaded && commandsDir) {
        const resolved = path.resolve(commandsDir);
        if (!loadInFlight || loadInFlightDir !== resolved) {
            loadInFlightDir = resolved;
            loadInFlight = Promise.resolve().then(() => loadCommands(commandsDir));
        }
        try {
            await loadInFlight;
        } catch (e) {
            console.warn(`⚠️ loadCommands failed: ${e?.message || e}`);
            if (loadInFlightDir === resolved) {
                loadInFlight = null;
                loadInFlightDir = null;
            }
        }
    }

    const commands = options.commands || commandCache;

    try {
        if (!m || !Array.isArray(m.messages) || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;
        if (!msg.key || !msg.key.remoteJid) return;

        // FIX #20: guard msg.key.id before calling dedupe — undefined ids
        // must never be treated as "already seen"
        if (services.dedupe?.isDuplicate && msg.key.id) {
            try {
                const dup = await services.dedupe.isDuplicate(msg.key.id, { sessionId: userId });
                if (dup) return;
            } catch (e) {}
        }

        try { services.watchdog?.heartbeat?.(userId); } catch {}

        const from      = msg.key.remoteJid;
        // FIX #1 (orig): prefer participant, fall back appropriately
        const sender    = msg.key.participant
            || (msg.key.fromMe ? conn?.user?.id : msg.key.remoteJid)
            || msg.key.remoteJid;
        const pushname  = msg.pushName || "Unknown";
        const isGroup   = from.endsWith("@g.us");
        const isChannel = from.endsWith("@newsletter");
        if (isChannel) return;

        const normalized = unwrapMessage(msg.message);
        const type       = Object.keys(normalized)[0];
        const body       = extractBody(normalized, type);

        const prefix   = config.prefix || ".";
        const isCmd    = !!(body && body.startsWith(prefix));
        const command  = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
        const args     = isCmd ? body.trim().split(/\s+/).slice(1) : [];

        const isOwner  = isOwnerCheck(sender, msg, config);

        let isAdmin = false;
        let botIsAdmin = false;
        let groupMetadata = null;

        if (isGroup) {
            try {
                groupMetadata = await conn.groupMetadata(from);

                // FIX #10: LID-aware comparison so admin detection works in
                // groups that use @lid JIDs
                const senderParticipant = groupMetadata.participants.find(
                    p => jidEquals(p.id, sender)
                );
                isAdmin = senderParticipant?.admin === 'admin'
                    || senderParticipant?.admin === 'superadmin';

                // FIX #14 + #10: use safe botId and LID-aware comparison
                const botId = getBotId(conn);
                const botParticipant = groupMetadata.participants.find(
                    p => jidEquals(p.id, botId)
                );
                botIsAdmin = botParticipant?.admin === 'admin'
                    || botParticipant?.admin === 'superadmin';
            } catch (e) {}
        }

        // ============================================================
        // 👑 MASTER OWNER OVERRIDE
        // ============================================================
        if (isOwner) {
            isAdmin = true;
        }

        const ctx = {
            conn, msg, from, sender, pushname,
            userId, config, body, args, command, prefix,
            isGroup, isChannel, isCmd, isOwner, isAdmin, botIsAdmin,
            fancy,
            type,
            normalized,
            // FIX #12: log errors instead of silently swallowing; still return null
            reply: async (text, extra = {}) => {
                try { return await conn.sendMessage(from, { text, ...extra }, { quoted: msg }); }
                catch (e) {
                    console.error("ctx.reply failed:", e?.message || e);
                    return null;
                }
            },
            send: async (payload, extra = {}) => {
                try { return await conn.sendMessage(from, payload, { quoted: msg, ...extra }); }
                catch (e) {
                    console.error("ctx.send failed:", e?.message || e);
                    return null;
                }
            },
        };

        // ============================================================
        // 🛡️ ANTI-PROTECTION ENFORCER
        // ============================================================
        // FIX #9 (orig) / #9: only exempt fromMe when it's genuinely our own
        // session (sender === bot id). Otherwise a self-message inside a group
        // from a linked device would bypass moderation.
        const botIdForSelfCheck = getBotId(conn);
        const isSelf = msg.key.fromMe
            && (jidEquals(sender, botIdForSelfCheck) || sender === conn?.user?.id);

        if (isGroup && !isAdmin && !isSelf) {
            let shouldDelete = false;
            let shouldKick = false;
            let warnMsg = "";

            // Anti-Link
            if (global.antiLinkGroups?.has(from) && body) {
                const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(t\.me\/[^\s]+)/i;
                // FIX #22 (orig): don't nuke legitimate commands from non-admins
                const isKnownCommand = isCmd && commands.has(command);
                if (!isKnownCommand && linkRegex.test(body)) {
                    shouldDelete = true;
                    warnMsg = `⚠️ @${parseJid(sender).num} *Links are not allowed in this group!*`;
                }
            }

            // Anti-Media
            if (!shouldDelete && global.antiMediaGroups?.has(from)) {
                if (["imageMessage", "videoMessage", "audioMessage", "documentMessage"].includes(type)) {
                    shouldDelete = true;
                    warnMsg = `⚠️ @${parseJid(sender).num} *Media is not allowed in this group!*`;
                }
            }

            // Anti-Sticker
            if (!shouldDelete && global.antiStickerGroups?.has(from) && type === "stickerMessage") {
                shouldDelete = true;
                warnMsg = `⚠️ @${parseJid(sender).num} *Stickers are not allowed in this group!*`;
            }

            // Anti-Spam (also catches button-click spam — FIX #11)
            if (!shouldDelete && global.antiSpamGroups?.has(from)) {
                const spamText = body || getInteractiveReplyId(normalized);
                if (spamText) {
                    const spamKey = `${from}_${parseJid(sender).num}_${parseJid(sender).domain}`;
                    const now = Date.now();
                    const entry = spamTracker.get(spamKey) || { times: [] };
                    entry.times = entry.times.filter(t => now - t < SPAM_WINDOW_MS);
                    entry.times.push(now);
                    spamTracker.set(spamKey, entry);

                    if (entry.times.length > SPAM_MAX_HITS) {
                        shouldDelete = true;
                        shouldKick = true;
                        warnMsg = `🚨 @${parseJid(sender).num} *has been kicked for spamming!*`;
                    }
                }
            }

            if (shouldDelete) {
                if (!botIsAdmin) {
                    console.log(`Anti-Protection triggered but bot is not admin in ${from}`);
                } else {
                    try {
                        await conn.sendMessage(from, { delete: msg.key });
                    } catch (e) {
                        console.error("Anti-Protection delete failed:", e?.message || e);
                    }
                    // FIX #5: always clean up spam tracker for this user, even
                    // if the warn/kick throws, to prevent unbounded growth
                    try {
                        if (shouldKick) {
                            await conn.sendMessage(from, { text: warnMsg, mentions: [sender] });
                            await conn.groupParticipantsUpdate(from, [sender], "remove");
                        } else if (warnMsg) {
                            await conn.sendMessage(from, { text: warnMsg, mentions: [sender] });
                        }
                    } catch (e) {
                        console.error("Anti-Protection warning/kick failed:", e?.message || e);
                    } finally {
                        if (shouldKick) {
                            spamTracker.delete(
                                `${from}_${parseJid(sender).num}_${parseJid(sender).domain}`
                            );
                        }
                    }
                    return;
                }
            }
        }

        // FIX #6 (orig): pass normalized into routeButtons
        try {
            if (await routeButtons(conn, msg, ctx, commands, services, normalized)) return;
        } catch (e) { console.error("routeButtons failed:", e?.message || e); }

        if (!isCmd) {
            try {
                if (await routeGameInput(ctx, services)) return;
            } catch (e) { console.error("routeGameInput failed:", e?.message || e); }
        }

        if (!isCmd || !command) return;

        const mod = commands.get(command);
        if (!mod || typeof mod.execute !== "function") return;

        if (mod.ownerOnly === true && !isOwner) {
            await ctx.reply("❌ Owner only.");
            return;
        }

        try {
            await mod.execute(conn, msg, args, ctx);
        } catch (e) {
            console.error(`Command "${command}" failed:`, e?.stack || e?.message || e);
            await ctx.reply("❌ Command failed. Try again later.");
        }

    } catch (err) {
        console.error("presenter fatal:", err?.stack || err?.message || err);
    }
}

function unwrapMessage(message) {
    if (!message || typeof message !== "object") return message || {};
    const WRAPPERS = [
        "ephemeralMessage",
        "viewOnceMessage",
        "viewOnceMessageV2",
        "viewOnceMessageV2Extension",
        "documentWithCaptionMessage",
        "editedMessage",
    ];
    for (const k of WRAPPERS) {
        if (message[k]?.message) return unwrapMessage(message[k].message);
    }
    return message;
}

function extractBody(normalized, type) {
    if (!normalized) return "";
    switch (type) {
        case "conversation":        return normalized.conversation || "";
        case "extendedTextMessage": return normalized.extendedTextMessage?.text || "";
        case "imageMessage":        return normalized.imageMessage?.caption || "";
        case "videoMessage":        return normalized.videoMessage?.caption || "";
        case "documentMessage":     return normalized.documentMessage?.caption || "";
        default:                    return "";
    }
}

/**
 * FIX #11: pull the reply/button id out of interactive messages so anti-spam
 * can count button-click spam and games can inspect it.
 */
function getInteractiveReplyId(normalized) {
    if (!normalized) return "";
    return (
        normalized?.buttonsResponseMessage?.selectedButtonId ||
        normalized?.templateButtonReplyMessage?.selectedId ||
        normalized?.listResponseMessage?.singleSelectReply?.selectedRowId ||
        ""
    ) || "";
}

function isOwnerCheck(sender, msg, config) {
    const senderJid = parseJid(sender);
    if (!senderJid.num) return false;

    // FIX #3: be consistent — treat fromMe as owner in DMs only when the
    // message is actually our own session. In groups, require explicit
    // inclusion in config.ownerNumber OR being the bot id itself.
    if (msg.key?.fromMe) {
        const jid = String(msg.key.remoteJid || "");
        const isGroup = jid.endsWith("@g.us");
        if (!isGroup) return true;
        // In a group, fromMe from OUR OWN session means we (the bot) sent it.
        // That should count as owner — but only if the sender is us.
        const senderNum = senderJid.num;
        const botNum = normalizeNumber(msg?.key?.participant || "");
        // participant is who the message is attributed to in fromMe group msgs;
        // if unset, fall back to remoteJid -> but that's the group itself.
        // Safer: require config ownerNumber match for fromMe group messages.
        if (botNum && senderNum === botNum) return true;
    }

    if (!config?.ownerNumber) return false;
    const owners = String(config.ownerNumber)
        .split(",")
        .map(s => parseJid(s))
        .filter(o => o.num);
    return owners.some(o => {
        if (o.num !== senderJid.num) return false;
        // If owner config explicitly includes a domain, require match
        if (o.domain && senderJid.domain) return o.domain === senderJid.domain;
        return true;
    });
}

// FIX #1, #2, #5, #6, #7 (orig) — button routing
async function routeButtons(conn, msg, ctx, commands, services, normalized) {
    const src = normalized || msg.message || {};
    const buttonId =
        src?.buttonsResponseMessage?.selectedButtonId ||
        src?.templateButtonReplyMessage?.selectedId ||
        src?.listResponseMessage?.singleSelectReply?.selectedRowId;

    if (!buttonId) return false;

    if (!buttonId.startsWith("run_command:")) return false;

    // FIX #2 (orig): read contextInfo from the CORRECT interactive message,
    // not from extendedTextMessage.
    const contextInfo =
        src?.buttonsResponseMessage?.contextInfo ||
        src?.templateButtonReplyMessage?.contextInfo ||
        src?.listResponseMessage?.contextInfo ||
        null;

    const quotedStanzaId = contextInfo?.stanzaId;
    const quotedParticipant = contextInfo?.participant;

    // FIX #18 (orig): authorization policy
    let authorized = false;
    if (services.buttonAuth?.verify) {
        try {
            authorized = await services.buttonAuth.verify({
                buttonId,
                quotedStanzaId,
                quotedParticipant,
                sender: ctx.sender,
                from: ctx.from,
                msg,
            });
        } catch (e) {
            authorized = false;
        }
    } else {
        // Default policy: real WhatsApp button replies always carry contextInfo
        authorized = !!contextInfo;
    }

    if (!authorized) {
        console.warn(`🚫 Rejected unverified button id "${buttonId}" from ${ctx.sender}`);
        return true; // consumed, nothing executed
    }

    // FIX #1 (orig): parse name BEFORE lookup so args work
    const raw = buttonId.slice("run_command:".length).trim();
    if (!raw) return true;
    const parts = raw.split(":");
    const realName = (parts.shift() || "").toLowerCase();
    const args = parts.map(s => s.trim()).filter(Boolean);

    if (!realName) return true;

    const mod = commands.get(realName);
    if (!mod || typeof mod.execute !== "function") return true;

    if (mod.ownerOnly === true && !ctx.isOwner) {
        await ctx.reply("❌ Owner only.");
        return true;
    }

    try {
        await mod.execute(conn, msg, args, {
            ...ctx,
            command: realName,
            args,
            body: `${ctx.prefix}${realName}${args.length ? " " + args.join(" ") : ""}`,
        });
    } catch (e) {
        console.error(`Button command "${realName}" failed:`, e?.stack || e?.message || e);
    }
    return true;
}

// FIX #7 (orig): real game input routing
async function routeGameInput(ctx, services) {
    const fn = services?.gameInput?.handle;
    if (typeof fn !== "function") return false;
    try {
        return await fn(ctx);
    } catch (e) {
        console.error("gameInput handler failed:", e?.message || e);
        return false;
    }
}

module.exports = handler;
module.exports.loadCommands    = loadCommands;
module.exports.reloadCommands  = reloadCommands;
module.exports.commandCache    = commandCache;
module.exports.commandOwners   = commandOwners;
module.exports.registerCommand = registerCommand;
module.exports.isOwnerCheck    = isOwnerCheck;
module.exports.unwrapMessage   = unwrapMessage;
module.exports.extractBody     = extractBody;
module.exports.normalizeNumber = normalizeNumber;
module.exports.parseJid        = parseJid;
module.exports.jidEquals       = jidEquals;
module.exports.getBotId        = getBotId;
module.exports.getInteractiveReplyId = getInteractiveReplyId;
module.exports.dispose         = dispose;