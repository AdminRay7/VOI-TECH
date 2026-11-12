// presenter.js — self-loading, dependency-injected, multi-user-safe command handler
const fs   = require("fs");
const path = require("path");
const { fancy } = require("./lib/font");

const commandCache = new Map();
const commandOwners = new Map();
let cacheLoaded = false;
let commandDir = null;      
let commandDirRaw = null;   
let loadInFlight = null;
let loadInFlightDir = null; 

function parseJid(input) {
    if (input == null) return { num: "", domain: "", isLid: false, raw: "" };
    const raw = String(input);
    const [numPartRaw, domainRaw = ""] = raw.split("@");
    const numPart = numPartRaw.split(":")[0]; 
    const num = numPart.replace(/\D/g, "");
    const domain = domainRaw.toLowerCase();
    return { num, domain, isLid: domain === "lid", raw };
}

function normalizeNumber(input) {
    return parseJid(input).num;
}

function jidEquals(a, b) {
    const A = parseJid(a);
    const B = parseJid(b);
    if (!A.num || !B.num) return false;
    if (A.num !== B.num) return false;
    if (A.domain && B.domain) return A.domain === B.domain;
    return true;
}

function getBotId(conn) {
    const raw = conn?.user?.id;
    if (!raw) return "";
    const { num, domain } = parseJid(raw);
    if (!num) return "";
    return domain ? `${num}@${domain}` : `${num}@s.whatsapp.net`;
}

function loadCommands(dir) {
    if (cacheLoaded) return commandCache;
    if (!dir) throw new Error("loadCommands: dir required");

    commandDirRaw = dir;
    commandDir = path.resolve(dir); 

    if (!fs.existsSync(commandDir)) {
        console.warn(`⚠️ Command dir not found: ${commandDirRaw}`);
        cacheLoaded = true;
        return commandCache;
    }

    const walk = (current) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (e) { return; }
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
        delete require.cache[require.resolve(filePath)];
        mod = require(filePath);
    } catch (e) { return; }

    if (!mod || typeof mod.execute !== "function") return;

    const names = [
        mod.name,
        ...(Array.isArray(mod.aliases) ? mod.aliases : [])
    ].filter(Boolean).map(n => String(n).toLowerCase().trim()).filter(Boolean);

    if (names.length === 0) return;

    for (const name of names) {
        const existing = commandOwners.get(name);
        if (existing && existing !== filePath) return;
    }

    for (const name of names) {
        commandCache.set(name, mod);
        commandOwners.set(name, filePath);
    }
}

function reloadCommands() {
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

    if (!cacheLoaded && commandsDir) {
        const resolved = path.resolve(commandsDir);
        if (!loadInFlight || loadInFlightDir !== resolved) {
            loadInFlightDir = resolved;
            loadInFlight = Promise.resolve().then(() => loadCommands(commandsDir));
        }
        try {
            await loadInFlight;
        } catch (e) {
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

        if (services.dedupe?.isDuplicate && msg.key.id) {
            try {
                const dup = await services.dedupe.isDuplicate(msg.key.id, { sessionId: userId });
                if (dup) return;
            } catch (e) {}
        }

        try { services.watchdog?.heartbeat?.(userId); } catch {}

        const from      = msg.key.remoteJid;
        const sender    = msg.key.participant || (msg.key.fromMe ? conn?.user?.id : msg.key.remoteJid) || msg.key.remoteJid;
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

        let isOwner = msg.key.fromMe;
        const senderNum = normalizeNumber(sender);
        if (config.ownerNumber) {
            const owners = String(config.ownerNumber).split(",").map(normalizeNumber);
            if (owners.includes(senderNum)) isOwner = true;
        }

        let isAdmin = false;
        let botIsAdmin = false;
        let groupMetadata = null;

        if (isGroup) {
            try {
                groupMetadata = await conn.groupMetadata(from);
                const senderParticipant = groupMetadata.participants.find(p => jidEquals(p.id, sender));
                isAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

                const botId = getBotId(conn);
                const botParticipant = groupMetadata.participants.find(p => jidEquals(p.id, botId));
                botIsAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
            } catch (e) {}
        }

        if (isOwner) {
            isAdmin = true;
        }

        const ctx = {
            conn, msg, from, sender, pushname,
            userId, config, body, args, command, prefix,
            isGroup, isChannel, isCmd, isOwner, isAdmin, botIsAdmin,
            fancy, type, normalized,
            reply: async (text, extra = {}) => {
                try { return await conn.sendMessage(from, { text, ...extra }, { quoted: msg }); }
                catch (e) { return null; }
            },
            send: async (payload, extra = {}) => {
                try { return await conn.sendMessage(from, payload, { quoted: msg, ...extra }); }
                catch (e) { return null; }
            },
        };

        // ============================================================
        // 🤖 ONMESSAGE ROUTING (Runs automated commands like antilink)
        // ============================================================
        const executedOnMessage = new Set();
        for (const [, mod] of commands) {
            if (executedOnMessage.has(mod)) continue;
            executedOnMessage.add(mod);

            if (typeof mod.onMessage === "function") {
                try {
                    const handled = await mod.onMessage(conn, msg, ctx);
                    if (handled === true) {
                        return; // Stop processing if the automated command handled it (e.g., deleted a link)
                    }
                } catch (e) {
                    console.error(`onMessage error in ${mod.name}:`, e.message);
                }
            }
        }

        try {
            if (await routeButtons(conn, msg, ctx, commands, services, normalized)) return;
        } catch (e) { }

        if (!isCmd) return;

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
    const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage"];
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

async function routeButtons(conn, msg, ctx, commands, services, normalized) {
    const src = normalized || msg.message || {};
    const buttonId =
        src?.buttonsResponseMessage?.selectedButtonId ||
        src?.templateButtonReplyMessage?.selectedId ||
        src?.listResponseMessage?.singleSelectReply?.selectedRowId;

    if (!buttonId) return false;
    if (!buttonId.startsWith("run_command:")) return false;

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
        await mod.execute(conn, msg, args, { ...ctx, command: realName, args, body: `${ctx.prefix}${realName}${args.length ? " " + args.join(" ") : ""}` });
    } catch (e) { }
    return true;
}

module.exports = handler;
module.exports.loadCommands    = loadCommands;
module.exports.reloadCommands  = reloadCommands;
module.exports.commandCache    = commandCache;
module.exports.commandOwners   = commandOwners;
module.exports.registerCommand = registerCommand;
module.exports.unwrapMessage   = unwrapMessage;
module.exports.extractBody     = extractBody;
module.exports.normalizeNumber = normalizeNumber;
module.exports.parseJid        = parseJid;
module.exports.jidEquals       = jidEquals;
module.exports.getBotId        = getBotId;