require("dotenv").config();

const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestWaWebVersion // FIX: Use Web version to prevent immediate drops
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
const activeSockets = new Map();
const pairingCodes = new Map(); 

// ============================================================
// MONGODB CONNECTION & RESUME
// ============================================================
if (config.mongodb) {
    mongoose.connect(config.mongodb)
        .then(() => {
            console.log("✅ MongoDB Connected");
            resumeSessions(); // Only resume after DB is ready
        })
        .catch(e => {
            console.error("❌ MongoDB Error:", e.message);
            process.exit(1);
        });
} else {
    console.error("❌ MONGODB_URI is required in .env!");
    process.exit(1);
}

// ============================================================
// START A SOCKET FOR A SPECIFIC USER
// ============================================================
async function connectUser(phoneNumber, isPairing = false) {
    const sessionId = phoneNumber.replace(/\D/g, "");
    
    // If we are just resuming and it's already running, return
    if (!isPairing && activeSockets.has(sessionId)) return activeSockets.get(sessionId);

    const { state, saveCreds } = await useMongoAuthState(sessionId);
    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome"), 
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000, // Heroku WebSocket ping fix
        retryRequestDelayMs: 2000
    });

    activeSockets.set(sessionId, sock);
    sock.ev.on("creds.update", saveCreds);

    // ============================================================
    // PAIRING LOGIC (Event-Driven)
    // ============================================================
    if (isPairing) {
        return new Promise((resolve, reject) => {
            // 30 second timeout to prevent hanging forever
            const timeout = setTimeout(() => {
                sock.ev.off("connection.update", handler);
                reject(new Error("Timeout waiting for WhatsApp to connect. Try again."));
            }, 30000);

            const handler = async (update) => {
                const { connection, qr, lastDisconnect } = update;

                // WhatsApp is ready to generate the code
                if (qr || connection === "connecting") {
                    try {
                        const code = await sock.requestPairingCode(sessionId);
                        const formatted = code.match(/.{1,4}/g)?.join("-") || code;
                        
                        clearTimeout(timeout);
                        sock.ev.off("connection.update", handler);
                        resolve({ sock, formatted });
                    } catch (e) {
                        clearTimeout(timeout);
                        sock.ev.off("connection.update", handler);
                        reject(e);
                    }
                }

                // If it drops before we get a code
                if (connection === "close") {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    clearTimeout(timeout);
                    sock.ev.off("connection.update", handler);
                    activeSockets.delete(sessionId);
                    reject(new Error(`Connection closed before pairing. Code: ${code || 'Unknown'}`));
                }
            };

            sock.ev.on("connection.update", handler);
        });
    }

    // ============================================================
    // NORMAL CONNECTION LOGIC (For Resuming)
    // ============================================================
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log(`✅ User connected: ${sessionId}`);
            pairingCodes.delete(sessionId); 
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ User ${sessionId} closed, code: ${code}`);

            activeSockets.delete(sessionId);

            // 428 = Heroku Timeout, 515 = Restart required
            if (code === 428 || code === 515) {
                console.log(`🔄 Reconnecting ${sessionId} immediately...`);
                setTimeout(() => connectUser(sessionId, false), 1000);
            } 
            // 401 = Logged out
            else if (code === 401) {
                console.log(`🚪 User ${sessionId} logged out.`);
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
// WEB ENDPOINTS
// ============================================================
app.post("/api/pair", async (req, res) => {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    phone = phone.replace(/\D/g, "");
    if (phone.length < 10) return res.status(400).json({ error: "Invalid phone number" });

    try {
        // Pass true to trigger the pairing logic
        const { sock, formatted } = await connectUser(phone, true);

        pairingCodes.set(phone, formatted);
        console.log(`🔑 Generated code for ${phone}: ${formatted}`);
        
        res.json({ code: formatted });

    } catch (e) {
        console.error("Pair error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/status/:phone", (req, res) => {
    const phone = req.params.phone.replace(/\D/g, "");
    const sock = activeSockets.get(phone);
    res.json({
        connected: !!sock && sock.ws?.readyState === 1,
        code: pairingCodes.get(phone) || null,
        dbConnected: mongoose.connection.readyState === 1
    });
});

// ============================================================
// BOOT & RESUME
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
});

async function resumeSessions() {
    try {
        const existing = await mongoose.connection.collection("mongosessions").find().toArray();
        if (existing.length > 0) {
            console.log(`🔄 Resuming ${existing.length} existing sessions...`);
            for (const doc of existing) {
                // Pass false so it acts as a normal connection, not a pairing request
                connectUser(doc._id, false).catch(e => {
                    console.error(`Failed to resume ${doc._id}:`, e.message);
                });
            }
        }
    } catch (e) { 
        // Ignore if collection doesn't exist yet
    }
}