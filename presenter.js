// presenter.js — self-loading, dependency-injected, multi-user-safe command handler
const fs   = require("fs");
const path = require("path");
const { fancy } = require("./lib/font"); // IMPORT FONT

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
            console.error(`⚠️ readdir failed ${current}:`, e.message);
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
        console.error(`⚠️ Failed to require ${filePath}:`, e.message);
        return;
    }

    if (!mod || typeof mod.execute !== "function") return;

    const names = [
        mod.name,
        ...(Array.isArray(mod.aliases) ? mod.aliases : [])
    ].filter(Boolean).map(n => String(n).toLowerCase().trim()).filter(Boolean);

    if (names.length === 0) {
        console.warn(`⚠️ ${filePath} has no name/aliases — skipped`);
        return;
    }

    for (const name of names) {
        if (commandCache.has(name)) {
            const prev = commandOwners.get(name);
            console.warn(`⚠️ Duplicate command "${name}" — ${filePath} overwrites ${prev}`);
        }
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
        try { await loadInFlight; } catch (e) { console.error("[presenter] autoload failed:", e.message); }
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
            } catch (e) {
                console.error("[presenter] dedupe error:", e.message);
            }
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

        const privateMode = config.privateMode;
        let canUse = true;
        if (privateMode && !isOwner) {
            if (privateMode === true || privateMode === "dm") {
                canUse = !isGroup;
            } else if (privateMode === "all" || privateMode === "owner") {
                canUse = false;
            }
        }

        const ctx = {
            conn, msg, from, sender, pushname,
            userId, config, body, args, command, prefix,
            isGroup, isChannel, isCmd, isOwner,
            isPrivateMode: !!privateMode,
            canUse,
            fancy, // PASS FANCY FUNCTION
            type,
            normalized,
            reply: async (text, extra = {}) => {
                try { return await conn.sendMessage(from, { text, ...extra }, { quoted: msg }); }
                catch (e) { console.error("[presenter] reply failed:", e.message); }
            },
            send: async (payload, extra = {}) => {
                try { return await conn.sendMessage(from, payload, { quoted: msg, ...extra }); }
                catch (e) { console.error("[presenter] send failed:", e.message); }
            },
        };

        try {
            if (await routeButtons(conn, msg, ctx, commands, services)) return;
        } catch (e) { console.error("[presenter] routeButtons fatal:", e?.message || e); }

        if (!isCmd) {
            try {
                if (await routeGameInput(ctx, services)) return;
            } catch (e) { console.error("[presenter] routeGameInput fatal:", e?.message || e); }
        }

        // ============================================================
        // AI AUTO-REPLY TRIGGER (Handles Text AND Images)
        // ============================================================
        const isImage = !!normalized.imageMessage || 
                        !!msg.message?.imageMessage || 
                        !!msg.message?.viewOnceMessageV2?.message?.imageMessage || 
                        !!msg.message?.ephemeralMessage?.message?.imageMessage;

        if (!isCmd && (body || isImage)) {
            try {
                if (await routeAutoReply(conn, msg, ctx, commands)) return;
            } catch (e) { console.error("[presenter] routeAutoReply fatal:", e?.message || e); }
        }

        if (!isCmd || !command) return;

        const mod = commands.get(command);
        if (!mod || typeof mod.execute !== "function") {
            if (config.debugUnknownCommands) {
                console.warn(`[presenter] unknown command "${command}"`);
            }
            return;
        }

        if (!canUse) {
            if (config.privateModeReply !== false) {
                await ctx.reply("🔒 Private mode is on. Commands are restricted.");
            }
            return;
        }

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
        case "buttonsResponseMessage": return normalized.buttonsResponseMessage?.selectedDisplayText || "";
        case "listResponseMessage": return normalized.listResponseMessage?.title || "";
        case "templateButtonReplyMessage": return normalized.templateButtonReplyMessage?.selectedDisplayText || "";
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
        if (!ctx.canUse) { await ctx.reply("🔒 Private mode is on."); return true; }
        if (mod.ownerOnly === true && !ctx.isOwner) { await ctx.reply("❌ Owner only."); return true; }
        try {
            await mod.execute(conn, msg, [], { ...ctx, command: name, args: [], body: `${ctx.prefix}${name}` });
        } catch (e) { console.error(`Button-run "${name}" error:`, e?.stack || e?.message || e); }
        return true;
    }

    if (buttonId.startsWith("game:") && services.gameEngine?.sendInput) {
        const parts = buttonId.split(":");
        const input = parts[2];
        try {
            const handled = await services.gameEngine.sendInput(ctx.userId, ctx.from, ctx.sender, input);
            if (handled) return true;
        } catch (e) { console.error("game sendInput error:", e.message); }
    }

    const seen = new Set();
    for (const [, mod] of commands) {
        if (seen.has(mod)) continue;
        seen.add(mod);
        if (typeof mod.handleButton !== "function") continue;
        try {
            const handled = await mod.handleButton(conn, msg, buttonId, ctx);
            if (handled === true) return true;
        } catch (e) { console.error("handleButton error:", e.message); }
    }
    return false;
}

async function routeGameInput(ctx, services) {
    const { body, from, sender, userId } = ctx;
    if (!body) return false;
    if (!services.gameEngine?.hasActiveGame || !services.gameEngine?.sendInput) return false;
    let active = false;
    try { active = services.gameEngine.hasActiveGame(userId, from, sender); } catch { return false; }
    if (!active) return false;
    const trimmed = body.trim().toLowerCase();
    let isDir = false;
    try {
        isDir = typeof services.gameEngine.isDirection === "function" ? services.gameEngine.isDirection(trimmed) : ["u","d","l","r","up","down","left","right"].includes(trimmed);
    } catch { return false; }
    if (!isDir) return false;
    try { return (await services.gameEngine.sendInput(userId, from, sender, trimmed)) === true; } catch { return false; }
}

const AI_COMMAND_NAME = "chat-ai";
async function routeAutoReply(conn, msg, ctx, commands) {
    const ai = commands.get(AI_COMMAND_NAME);
    if (!ai || typeof ai.handleAutoReply !== "function") return false;
    try { return (await ai.handleAutoReply(conn, msg, ctx)) === true; } catch (e) { return false; }
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