require("dotenv").config();

const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const config = require("./config");
const handler = require("./presenter");
const services = require("./lib/services");
const { useMongoAuthState } = require("./lib/mongoAuthState");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Active Sessions Map ----
// Key: sessionId (phone number), Value: Baileys Socket
const activeSockets = new Map();
const pairingCodes = new Map(); // Store codes temporarily for the frontend

// ---- Connect to MongoDB ----
if (config.mongodb) {
    mongoose.connect(config.mongodb).then(() => console.log("✅ MongoDB connected")).catch(e => console.error("❌ MongoDB:", e.message));
} else {
    console.error("❌ MONGODB_URI is required for multi-user mode!");
    process.exit(1);
}

// ============================================================
// START A SOCKET FOR A SPECIFIC USER
// ============================================================
async function connectUser(phoneNumber) {
    const sessionId = phoneNumber.replace(/\D/g, "");
    if (activeSockets.has(sessionId)) return; // Already running

    const { state, saveCreds } = await useMongoAuthState(sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome"), // Use ubuntu to avoid pairing issues
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000, // Heroku WebSocket fix (ping every 25s)
        retryRequestDelayMs: 2000
    });

    activeSockets.set(sessionId, sock);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log(`✅ User connected: ${sessionId}`);
            pairingCodes.delete(sessionId); // Clear the code, it's connected now
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ User ${sessionId} closed, code: ${code}`);
            
            activeSockets.delete(sessionId);

            // 428 = Heroku Timeout, 515 = Restart required
            if (code === 428 || code === 515) {
                console.log(`🔄 Reconnecting ${sessionId} immediately...`);
                setTimeout(() => connectUser(sessionId), 1000);
            } 
            // 401 = Logged out
            else if (code === 401) {
                console.log(`🚪 User ${sessionId} logged out.`);
                // Delete session from Mongo here if you want
            }
        }
    });

    sock.ev.on("messages.upsert", async (evt) => {
        if (!evt?.messages?.length) return;
        try {
            await handler(sock, evt, {
                userId: sessionId,
                config,
                helpers: {},
                services
            });
        } catch (e) {
            console.error("Handler Error:", e);
        }
    });

    return sock;
}

// ============================================================
// WEB ENDPOINTS (API for the frontend)
// ============================================================
app.post("/api/pair", async (req, res) => {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    phone = phone.replace(/\D/g, "");
    if (phone.length < 10) return res.status(400).json({ error: "Invalid phone number" });

    try {
        // 1. Start connection
        const sock = await connectUser(phone);

        // 2. Wait for socket to be ready for pairing
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout waiting for socket")), 15000);
            const check = setInterval(() => {
                if (sock.ws?.readyState === 1) {
                    clearInterval(check);
                    clearTimeout(timeout);
                    resolve();
                }
            }, 500);
        });

        // 3. Request Code
        const code = await sock.requestPairingCode(phone);
        const formatted = code.match(/.{1,4}/g)?.join("-") || code;

        pairingCodes.set(phone, formatted);
        res.json({ code: formatted });

    } catch (e) {
        console.error("Pair error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/status/:phone", (req, res) => {
    const phone = req.params.phone.replace(/\D/g, "");
    res.json({
        connected: activeSockets.has(phone) && activeSockets.get(phone).ws?.readyState === 1,
        code: pairingCodes.get(phone) || null
    });
});

// ============================================================
// BOOT
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
});

// Resume any existing sessions from Database on startup
(async () => {
    try {
        const existing = await mongoose.connection.collection("mongosessions").find().toArray();
        console.log(`🔄 Resuming ${existing.length} existing sessions...`);
        for (const doc of existing) {
            connectUser(doc._id).catch(e => console.error(`Failed to resume ${doc._id}:`, e.message));
        }
    } catch (e) { /* ignore first boot if collection is empty */ }
})();