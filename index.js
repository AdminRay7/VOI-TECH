// index.js — 303-XMD bootstrap
require("dotenv").config();

const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const handler = require("./presenter");
const services = require("./lib/services");

// ---- Session state ----
const session = {
    conn: null,
    connecting: false,
    pairingReady: false,
    socketReady: false,
    reconnectTimer: null,
    pairing: null,
    bootPromise: null,
    shuttingDown: false
};

const RECONNECT_MS = 5000;
const PAIR_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Ensure session dir exists ----
if (!fs.existsSync(config.sessionDir)) {
    fs.mkdirSync(config.sessionDir, { recursive: true });
}

// ============================================================
// BOOT SOCKET
// ============================================================
function bootSocket() {
    if (session.socketReady && session.conn) return Promise.resolve(session.conn);
    if (session.bootPromise) return session.bootPromise;
    if (session.shuttingDown) return Promise.reject(new Error("Shutting down"));

    session.bootPromise = (async () => {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
            const { version } = await fetchLatestBaileysVersion();

            const conn = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: config.logLevel }))
                },
                logger: pino({ level: config.logLevel }),
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 60000,
                retryRequestDelayMs: 2000
            });

            session.conn = conn;
            conn.ev.on("creds.update", saveCreds);

            conn.ev.on("connection.update", (update) => {
                handleConnectionUpdate(conn, update).catch(err => {
                    console.error("connection.update handler:", err?.message || err);
                });
            });

            conn.ev.on("messages.upsert", async (evt) => {
                if (!evt?.messages?.length) return;
                try {
                    await handler(conn, evt, {
                        userId: conn.user?.id || "default",
                        config,
                        helpers: {},
                        services
                    });
                } catch (e) {
                    console.error("handler error:", e?.stack || e?.message || e);
                }
            });

            return conn;
        } finally {
            session.bootPromise = null;
        }
    })();

    return session.bootPromise;
}

// ============================================================
// CONNECTION UPDATE
// ============================================================
async function handleConnectionUpdate(conn, update) {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
        session.connecting = true;
        const until = Date.now() + 15000;
        while (Date.now() < until && session.conn === conn && !session.pairingReady) {
            if (conn.ws?.readyState === 1) {
                session.pairingReady = true;
                console.log("🔌 pairing-ready (ws open)");
                break;
            }
            await sleep(100);
        }
        return;
    }

    if (connection === "open") {
        session.connecting = false;
        session.pairingReady = true;
        session.socketReady = true;
        session.pairing = null;

        if (session.reconnectTimer) {
            clearTimeout(session.reconnectTimer);
            session.reconnectTimer = null;
        }

        console.log("✅ connected as", conn.user?.id);
        return;
    }

    if (connection === "close") {
        session.connecting = false;
        session.pairingReady = false;
        session.socketReady = false;

        if (session.conn !== conn) return;

        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("❌ closed, code:", code);

        if (session.shuttingDown) return;

        // Terminal states — check BEFORE the reconnectTimer guard
        if (code === 401 || code === DisconnectReason.loggedOut) {
            console.log("🚪 logged out — stopping");
            session.shuttingDown = true;
            return;
        }
        if (code === 440) return; // replaced by another session

        if (session.reconnectTimer) return;
        session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            if (session.shuttingDown) return;
            if (session.socketReady) return;
            if (session.conn && !session.socketReady) session.conn = null;
            bootSocket().catch(e => console.error("Reconnect:", e.message));
        }, RECONNECT_MS);
    }
}

// ============================================================
// PAIRING
// ============================================================
async function requestPairingCode(phoneNumber) {
    if (!session.conn || (!session.pairingReady && !session.socketReady)) {
        await bootSocket();
    }

    const deadline = Date.now() + PAIR_TIMEOUT_MS;
    while (!session.pairingReady && Date.now() < deadline) {
        if (!session.conn) throw new Error("Socket lost during pairing");
        await sleep(250);
    }
    if (!session.pairingReady) throw new Error("Socket not ready for pairing");
    if (session.conn.ws?.readyState !== 1) throw new Error("WebSocket not open");

    let code;
    try {
        code = await session.conn.requestPairingCode(phoneNumber);
    } catch (e) {
        if (!/Connection Closed|not open|timed out|closed/i.test(e?.message || "")) throw e;
        await sleep(1500);
        if (session.conn.ws?.readyState !== 1) throw new Error("Socket closed while requesting code");
        code = await session.conn.requestPairingCode(phoneNumber);
    }

    const formatted = code.match(/.{1,4}/g)?.join("-") || code;
    session.pairing = formatted;
    console.log("🔑 pairing code:", formatted);
    return formatted;
}

// ============================================================
// SHUTDOWN
// ============================================================
async function shutdown(reason) {
    if (session.shuttingDown) return;
    session.shuttingDown = true;
    console.log(`🛑 shutting down (${reason})`);

    if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
    }
    try { await session.conn?.end?.(undefined); } catch {}
    await sleep(200); // let saveCreds flush
    process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", err?.stack || err?.message || err);
});

// ============================================================
// EXPRESS (health + pairing helper page)
// ============================================================
function startWeb() {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, "public")));

    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            bot: config.botName,
            version: config.version,
            connected: !!session.socketReady,
            pairing: session.pairing || null,
            uptime: process.uptime()
        });
    });

    app.get("/pairing", (_req, res) => {
        res.json({ pairing: session.pairing || null, ready: !!session.pairingReady });
    });

    app.listen(config.port, () => {
        console.log(`🌐 web on :${config.port}`);
    });
}

// ============================================================
// COMMANDS
// ============================================================
function bootCommands() {
    handler.loadCommands(path.join(__dirname, "commands"));
}

// ============================================================
// RUN
// ============================================================
(async () => {
    bootCommands();
    services.init(config);

    try {
        await bootSocket();

        // If creds exist → auto reconnects. If not → need phone to pair.
        const credsPath = path.join(config.sessionDir, "creds.json");
        const hasCreds = fs.existsSync(credsPath);

        if (!hasCreds && config.phoneNumber) {
            const code = await requestPairingCode(config.phoneNumber);
            console.log(`\n→ Enter this code on your phone: ${code}\n`);
        } else if (!hasCreds && !config.phoneNumber) {
            console.warn("⚠️ No creds and no PHONE set. Set PHONE=2547XXXXXXXX in .env to pair.");
        } else {
            console.log("🔐 existing creds found — reconnecting");
        }
    } catch (e) {
        console.error("Boot error:", e?.message || e);
    }

    startWeb();
})();

module.exports = { bootSocket, requestPairingCode, session };