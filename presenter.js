// presenter.js — self-loading, dependency-injected, multi-user-safe command handler
const fs   = require("fs");
const path = require("path");
const { fancy } = require("./lib/font"); 

const commandCache = new Map();
const commandOwners = new Map();
let cacheLoaded = false;
let commandDir = null;
let loadInFlight = null;

function loadCommands(dir) {
    if (cacheLoaded) return commandCache;
    if (!dir) throw new Error("loadCommands: dir required");
    commandDir = dir;

    if (!fs.existsSync(dir)) {
        console.warn(`⚠️ Command dir not found: ${dir}`);
        cacheLoaded = true;
        return commandCache;
    }

    const walk = (current) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (e) {
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

    walk(dir);
    cacheLoaded = true;
    console.log(`✅ Loaded ${commandCache.size} command name(s)`);
    return commandCache;
}

function registerCommand(filePath) {
    let mod;
    try {
        delete require.cache[require.resolve(filePath)];
        mod = require(filePath);
    } catch (e) {
        return;
    }

    if (!mod || typeof mod.execute !== "function") return;

    const names = [
        mod.name,
        ...(Array.isArray(mod.aliases) ? mod.aliases : [])
    ].filter(Boolean).map(n => String(n).toLowerCase().trim()).filter(Boolean);

    if (names.length === 0) return;

    for (const name of names) {
        commandCache.set(name, mod);
        commandOwners.set(name, filePath);
    }
}

function reloadCommands() {
    if (commandDir) {
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(commandDir) && key.endsWith(".js")) {
                try { delete require.cache[key]; } catch {}
            }
        }
    }
    commandCache.clear();
    commandOwners.clear();
    cacheLoaded = false;
    loadInFlight = null;
    if (commandDir) loadCommands(commandDir);
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

    if (!cacheLoaded && commandsDir) {
        if (!loadInFlight) {
            loadInFlight = Promise.resolve().then(() => loadCommands(commandsDir));
        }
        try { await loadInFlight; } catch (e) { }
    }

    const commands = options.commands || commandCache;

    try {
        if (!m || !Array.isArray(m.messages) || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;
        if (!msg.key || !msg.key.remoteJid) return;

        if (services.dedupe?.isDuplicate) {
            try {
                const dup = await services.dedupe.isDuplicate(msg.key.id, { sessionId: userId });
                if (dup) return;
            } catch (e) {}
        }

        try { services.watchdog?.heartbeat?.(userId); } catch {}

        const from      = msg.key.remoteJid;
        const sender    = msg.key.participant || msg.key.remoteJid;
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
        if (isGroup) {
            try {
                const groupMetadata = await conn.groupMetadata(from);
                const participant = groupMetadata.participants.find(p => p.id === sender);
                isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            } catch (e) {}
        }

        const ctx = {
            conn, msg, from, sender, pushname,
            userId, config, body, args, command, prefix,
            isGroup, isChannel, isCmd, isOwner, isAdmin,
            fancy, 
            type,
            normalized,
            reply: async (text, extra = {}) => {
                try { return await conn.sendMessage(from, { text, ...extra }, { quoted: msg }); }
                catch (e) {}
            },
            send: async (payload, extra = {}) => {
                try { return await conn.sendMessage(from, payload, { quoted: msg, ...extra }); }
                catch (e) {}
            },
        };

        // ============================================================
        // 🛡️ ANTI-PROTECTION ENFORCER (Auto-Delete)
        // ============================================================
        // Check if the message is NOT from me, before enforcing anti-protections
        if (isGroup && !isAdmin && !isOwner && !msg.key.fromMe) {
            let shouldDelete = false;
            let warnMsg = "";

            // Anti-Link
            if (global.antiLinkGroups?.has(from) && body) {
                const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(t\.me\/[^\s]+)/gi;
                if (linkRegex.test(body)) {
                    shouldDelete = true;
                    warnMsg = `⚠️ @${sender.split('@')[0]} *Links are not allowed in this group!*`;
                }
            }

            // Anti-Media
            if (global.antiMediaGroups?.has(from)) {
                if (["imageMessage", "videoMessage", "audioMessage", "documentMessage"].includes(type)) {
                    shouldDelete = true;
                    warnMsg = `⚠️ @${sender.split('@')[0]} *Media is not allowed in this group!*`;
                }
            }

            // Anti-Sticker
            if (global.antiStickerGroups?.has(from) && type === "stickerMessage") {
                shouldDelete = true;
                warnMsg = `⚠️ @${sender.split('@')[0]} *Stickers are not allowed in this group!*`;
            }

            // Anti-Spam
            if (global.antiSpamGroups?.has(from)) {
                if (!global.spamTracker) global.spamTracker = new Map();
                const spamKey = `${from}_${sender}`;
                const now = Date.now();
                let userSpam = global.spamTracker.get(spamKey) || [];
                userSpam = userSpam.filter(time => now - time < 5000); 
                userSpam.push(now);
                global.spamTracker.set(spamKey, userSpam);

                if (userSpam.length > 5) { 
                    shouldDelete = true;
                    warnMsg = `🚨 @${sender.split('@')[0]} *has been kicked for spamming!*`;
                }
            }

            if (shouldDelete) {
                try {
                    await conn.sendMessage(from, { delete: msg.key });
                    if (warnMsg.includes("kicked")) {
                        await conn.sendMessage(from, { text: warnMsg, mentions: [sender] });
                        await conn.groupParticipantsUpdate(from, [sender], "remove");
                        if (global.spamTracker) global.spamTracker.delete(`${from}_${sender}`);
                    } else {
                        await conn.sendMessage(from, { text: warnMsg, mentions: [sender] });
                    }
                    return; 
                } catch (e) { console.error("Anti-Protection delete failed:", e.message); }
            }
        }

        try {
            if (await routeButtons(conn, msg, ctx, commands, services)) return;
        } catch (e) { }

        if (!isCmd) return; // Only process commands if it starts with prefix

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
    const WRAPPERS = ["ephemeralMessage","viewOnceMessage","viewOnceMessageV2","viewOnceMessageV2Extension","documentWithCaptionMessage","editedMessage"];
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

function normalizeNumber(input) {
    if (input == null) return "";
    return String(input).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isOwnerCheck(sender, msg, config) {
    const senderNum = normalizeNumber(sender);
    if (!senderNum) return false;
    if (msg.key?.fromMe) {
        const jid = String(msg.key.remoteJid || "");
        if (!jid.endsWith("@g.us")) return true;
    }
    if (!config?.ownerNumber) return false;
    const owners = String(config.ownerNumber).split(",").map(normalizeNumber).filter(Boolean);
    return owners.includes(senderNum);
}

async function routeButtons(conn, msg, ctx, commands, services) {
    const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.templateButtonReplyMessage?.selectedId || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (!buttonId) return false;
    if (buttonId.startsWith("run_command:")) {
        const name = buttonId.slice("run_command:".length).trim().toLowerCase();
        const mod = commands.get(name);
        if (!mod || typeof mod.execute !== "function") return true;
        if (mod.ownerOnly === true && !ctx.isOwner) { await ctx.reply("❌ Owner only."); return true; }
        try {
            await mod.execute(conn, msg, [], { ...ctx, command: name, args: [], body: `${ctx.prefix}${name}` });
        } catch (e) { }
        return true;
    }
    return false;
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