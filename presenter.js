// presenter.js — self-loading, dependency-injected, bug-hardened command handler
const fs   = require("fs");
const path = require("path");

// ============================================================
// COMMAND REGISTRY
// ============================================================
const commandCache = new Map();
const commandOwners = new Map();
let cacheLoaded = false;
let commandDir = null;

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
    commandCache.clear();
    commandOwners.clear();
    cacheLoaded = false;
    if (commandDir) loadCommands(commandDir);
    return commandCache;
}

// ============================================================
// ENTRY POINT
// ============================================================
async function handler(conn, m, options = {}) {
    const {
        userId = "default",
        config = {},
        commands = commandCache,
        helpers = {},
        services = {}
    } = options;

    try {
        // ---- 1. Validate ----
        if (!m || !m.messages || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;
        if (!msg.key || !msg.key.remoteJid) return;

        // ---- 2. Dedupe ----
        let dup = false;
        if (services.dedupe?.isDuplicate) {
            try {
                dup = await services.dedupe.isDuplicate(msg.key.id, { sessionId: userId });
                if (dup) return;
            } catch (e) {
                console.error("[presenter] dedupe error:", e.message);
            }
        }

        // ---- 3. Heartbeat ----
        try { services.watchdog?.heartbeat?.(userId); } catch {}

        // ---- 4. Parse ----
        const from      = msg.key.remoteJid;
        const sender    = msg.key.participant || msg.key.remoteJid;
        const pushname  = msg.pushName || "Unknown";
        const type      = Object.keys(msg.message)[0];
        const isGroup   = from.endsWith("@g.us");
        const isChannel = from.endsWith("@newsletter");

        if (isChannel) return;

        const body     = extractBody(msg, type);
        const prefix   = config.prefix || ".";
        const isCmd    = !!(body && body.startsWith(prefix));
        const command  = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
        const args     = isCmd ? body.trim().split(/\s+/).slice(1) : [];
        const isOwner  = isOwnerCheck(sender, msg, config);

        // ---- 5. Context ----
        const ctx = {
            conn, msg, from, sender, pushname,
            userId, config, body, args, command, prefix,
            isGroup, isChannel, isCmd, isOwner,
            fancy: helpers.fancy,
            type
        };

        // ---- 6. Button / list reply ----
        if (await routeButtons(conn, msg, ctx, commands, services)) return;

        // ---- 7. Game input ----
        if (!isCmd && await routeGameInput(ctx, services)) return;

        // ---- 8. AI auto-reply ----
        if (!isCmd && body && await routeAutoReply(conn, msg, ctx, commands)) return;

        // ---- 9. Command dispatch ----
        if (isCmd && command) {
            const mod = commands.get(command);
            if (!mod || typeof mod.execute !== "function") return;

            if (mod.ownerOnly === true && !isOwner) {
                try { await conn.sendMessage(from, { text: "❌ Owner only." }, { quoted: msg }); } catch {}
                return;
            }

            try {
                await mod.execute(conn, msg, args, ctx);
            } catch (e) {
                console.error(`Command "${command}" failed:`, e?.stack || e?.message || e);
                try { await conn.sendMessage(from, { text: "❌ Command failed. Try again later." }, { quoted: msg }); } catch {}
            }
        }

    } catch (err) {
        console.error("presenter fatal:", err?.stack || err?.message || err);
    }
}

// ============================================================
// BODY EXTRACTOR
// ============================================================
function extractBody(msg, type) {
    switch (type) {
        case "conversation":        return msg.message.conversation || "";
        case "extendedTextMessage": return msg.message.extendedTextMessage?.text || "";
        case "imageMessage":        return msg.message.imageMessage?.caption || "";
        case "videoMessage":        return msg.message.videoMessage?.caption || "";
        case "buttonsResponseMessage":
            return msg.message.buttonsResponseMessage?.selectedDisplayText || "";
        case "listResponseMessage":
            return msg.message.listResponseMessage?.title || "";
        default:                    return "";
    }
}

// ============================================================
// OWNER CHECK
// ============================================================
function isOwnerCheck(sender, msg, config) {
    if (msg.key.fromMe) return true;
    if (!config?.ownerNumber) return false;
    const owners = String(config.ownerNumber).split(",").map(s => s.trim()).filter(Boolean);
    const number = String(sender).split("@")[0].split(":")[0];
    return owners.includes(number);
}

// ============================================================
// BUTTON ROUTER
// ============================================================
async function routeButtons(conn, msg, ctx, commands, services) {
    const buttonId =
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;

    if (!buttonId) return false;

    if (buttonId.startsWith("run_command:")) {
        const name = buttonId.slice("run_command:".length).trim().toLowerCase();
        const mod = commands.get(name);
        if (!mod || typeof mod.execute !== "function") return true;
        if (mod.ownerOnly === true && !ctx.isOwner) return true;
        try {
            await mod.execute(conn, msg, [], { ...ctx, command: name, args: [], body: `${ctx.prefix}${name}` });
        } catch (e) {
            console.error(`Button-run "${name}" error:`, e?.stack || e?.message || e);
        }
        return true;
    }

    if (buttonId.startsWith("game:") && services.gameEngine?.sendInput) {
        const parts = buttonId.split(":");
        const input = parts[2];
        try {
            const handled = await services.gameEngine.sendInput(ctx.userId, ctx.from, ctx.sender, input);
            if (handled) return true;
        } catch (e) {
            console.error("game sendInput error:", e.message);
        }
    }

    const seen = new Set();
    for (const [, mod] of commands) {
        if (seen.has(mod)) continue;
        seen.add(mod);
        if (typeof mod.handleButton !== "function") continue;
        try {
            const handled = await mod.handleButton(conn, msg, buttonId, ctx);
            if (handled === true || handled === undefined) return true;
        } catch (e) {
            console.error("handleButton error:", e.message);
        }
    }
    return false;
}

// ============================================================
// GAME INPUT ROUTER
// ============================================================
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
        isDir = services.gameEngine.isDirection
            ? services.gameEngine.isDirection(trimmed)
            : ["u","d","l","r","up","down","left","right","⬆️","⬇️","⬅️","➡️","↑","↓","←","→","w","a","s","again","restart"].includes(trimmed);
    } catch { return false; }
    if (!isDir) return false;

    try {
        return (await services.gameEngine.sendInput(userId, from, sender, trimmed)) === true;
    } catch { return false; }
}

// ============================================================
// AI AUTO-REPLY ROUTER
// ============================================================
const AI_COMMAND_NAME = "chat-ai";

async function routeAutoReply(conn, msg, ctx, commands) {
    const ai = commands.get(AI_COMMAND_NAME);
    if (!ai || typeof ai.handleAutoReply !== "function") return false;
    try {
        return (await ai.handleAutoReply(conn, msg, ctx)) === true;
    } catch (e) {
        console.error("AI auto-reply error:", e.message);
        return false;
    }
}

// ============================================================
// EXPORT
// ============================================================
module.exports = handler;
module.exports.loadCommands    = loadCommands;
module.exports.reloadCommands  = reloadCommands;
module.exports.commandCache    = commandCache;
module.exports.registerCommand = registerCommand;