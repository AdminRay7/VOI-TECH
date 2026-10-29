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

const activeSockets = new Map();
const pairingCodes = new Map(); 

if (config.mongodb) {
    mongoose.connect(config.mongodb)
        .then(() => {
            console.log("✅ MongoDB Connected");
            resumeSessions(); 
        })
        .catch(e => {
            console.error("❌ MongoDB Error:", e.message);
            process.exit(1);
        });
} else {
    console.error("❌ MONGODB_URI is required in .env!");
    process.exit(1);
}

async function connectUser(phoneNumber, isPairing = false) {
    const sessionId = phoneNumber.replace(/\D/g, "");
    
    if (isPairing && activeSockets.has(sessionId)) {
        try { activeSockets.get(sessionId).end(); } catch(e) {}
        activeSockets.delete(sessionId);
    } else if (!isPairing && activeSockets.has(sessionId)) {
        return activeSockets.get(sessionId);
    }

    const { state, saveCreds } = await useMongoAuthState(sessionId);
    const { version } = await fetchLatestBaileysVersion();

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
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000
    });

    activeSockets.set(sessionId, sock);
    sock.ev.on("creds.update", saveCreds);

    if (isPairing) {
        return new Promise((resolve, reject) => {
            let codeRequested = false;
            const timeout = setTimeout(() => {
                sock.ev.off("connection.update", handler);
                try { sock.end(); } catch(e) {}
                activeSockets.delete(sessionId);
                reject(new Error("Timeout: WhatsApp did not respond."));
            }, 40000);

            const handler = async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if ((qr || connection === "connecting") && !codeRequested) {
                    codeRequested = true;
                    try {
                        await new Promise(r => setTimeout(r, 1000)); 
                        const rawCode = await sock.requestPairingCode(sessionId);
                        const formatted = rawCode.match(/.{1,4}/g)?.join("-") || rawCode;
                        
                        clearTimeout(timeout);
                        sock.ev.off("connection.update", handler);
                        resolve({ sock, formatted });
                    } catch (e) {
                        clearTimeout(timeout);
                        sock.ev.off("connection.update", handler);
                        activeSockets.delete(sessionId);
                        reject(e);
                    }
                }

                if (connection === "close") {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (!codeRequested) {
                        clearTimeout(timeout);
                        sock.ev.off("connection.update", handler);
                        activeSockets.delete(sessionId);
                        reject(new Error(`WhatsApp closed connection (Code: ${code || 'Unknown'})`));
                    }
                }
            };

            sock.ev.on("connection.update", handler);
        });
    }

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
            if (code === 428 || code === 515) {
                setTimeout(() => connectUser(sessionId, false), 2000);
            } 
        }
    });

    sock.ev.on("messages.upsert", async (evt) => {
        if (!evt?.messages?.length) return;
        try {
            await handler(sock, evt, { userId: sessionId, config, helpers: {}, services });
        } catch (e) {
            console.error("Handler Error:", e);
        }
    });

    return sock;
}

app.post("/api/pair", async (req, res) => {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    phone = phone.replace(/\D/g, "");
    if (phone.length < 10) return res.status(400).json({ error: "Invalid phone number" });

    try {
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

app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
});

// ============================================================
// SMART RESUME SESSIONS (ONLY RESUMES LINKED ACCOUNTS)
// ============================================================
async function resumeSessions() {
    try {
        const existing = await mongoose.connection.collection("mongosessions").find().toArray();
        
        // Filter: Only resume if WhatsApp actually linked the device (creds.me.id exists)
        const validSessions = existing.filter(doc => 
            doc.creds && 
            doc.creds.me && 
            doc.creds.me.id
        );

        // Clean up unlinked (dead) sessions
        const deadSessions = existing.filter(doc => 
            !doc.creds || !doc.creds.me || !doc.creds.me.id
        );

        if (deadSessions.length > 0) {
            for (const doc of deadSessions) {
                await mongoose.connection.collection("mongosessions").deleteOne({ _id: doc._id });
                console.log(`🗑️ Deleted unlinked/dead session: ${doc._id}`);
            }
        }

        if (validSessions.length > 0) {
            console.log(`🔄 Resuming ${validSessions.length} linked session(s)...`);
            for (const doc of validSessions) {
                connectUser(doc._id, false).catch(e => console.error(`Failed to resume ${doc._id}:`, e.message));
            }
        } else {
            console.log(`📭 No linked sessions found. Waiting for new pairings...`);
        }
    } catch (e) {
        console.log("No sessions found to resume.");
    }
}