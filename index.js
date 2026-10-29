require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const pino = require("pino");
const fs = require("fs");
const { MongoClient } = require("mongodb");
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    initAuthCreds,
    BufferJSON,
    proto
} = require("@whiskeysockets/baileys");

const config = require("./config");
const handler = require("./presenter");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// 1. LOAD COMMANDS ON BOOT
// ============================================================
const commandsDir = path.join(__dirname, "commands");
if (fs.existsSync(commandsDir)) {
    handler.loadCommands(commandsDir);
}

// ============================================================
// 2. MONGODB AUTH STATE
// ============================================================
async function useMongoDBAuthState(collection, sessionId) {
    const writeData = async (data, id) => {
        try {
            await collection.updateOne(
                { _id: id },
                { $set: { data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) } },
                { upsert: true }
            );
        } catch (error) {}
    };

    const readData = async (id) => {
        try {
            const doc = await collection.findOne({ _id: id });
            if (doc && doc.data) {
                return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
            }
            return null;
        } catch (error) { return null; }
    };

    const removeData = async (id) => {
        try { await collection.deleteOne({ _id: id }); } catch (error) {}
    };

    const credsId = `${sessionId}:creds`;
    const creds = (await readData(credsId)) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${sessionId}:${type}-${id}`);
                            if (type === "app-state-sync-key" && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${sessionId}:${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, credsId);
        }
    };
}

// ============================================================
// 3. GLOBAL STATE & DB INIT
// ============================================================
if (!global.sessions) global.sessions = new Map();
if (!global.mongoClient) global.mongoClient = null;
let pairingQueue = Promise.resolve();

async function initMongo() {
    if (!global.mongoClient) {
        global.mongoClient = new MongoClient(config.mongodb);
        await global.mongoClient.connect();
    }
    return global.mongoClient;
}

function authStateCollection() {
    return global.mongoClient.db("xmd303").collection("authState");
}

// ============================================================
// 4. PAIRING & BOOT LOGIC (FIXED 401 LOGOUT)
// ============================================================
async function bootSocket(sessionId, session) {
    await initMongo();
    const collection = authStateCollection();
    const { state: waState, saveCreds } = await useMongoDBAuthState(collection, sessionId);
    const { version } = await fetchLatestBaileysVersion();

    // FIX: Only use fireInitQueries: false if this is a NEW pairing.
    // If we are resuming, we MUST sync properly to avoid the 401 logout.
    const isNewSession = !waState.creds.me;

    const conn = makeWASocket({
        version,
        auth: {
            creds: waState.creds,
            keys: makeCacheableSignalKeyStore(waState.keys, pino({ level: "silent" }))
        },
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Safari"),
        syncFullHistory: false,
        markOnlineOnConnect: true, // Fix Heroku sleep
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000, 
        fireInitQueries: !isNewSession, // Prevents pairing crash, allows resume sync
        emitOwnEvents: false
    });

    session.conn = conn;
    conn.ev.on("creds.update", saveCreds);

    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "connecting") {
            session.socketReady = true;
            console.log(`🔌 [${sessionId}] socket ready`);
        }

        if (connection === "open") {
            session.socketReady = true;
            session.pairing = null;
            console.log(`✅ [${sessionId}] connected as ${conn.user?.id}`);
            
            try {
                await collection.updateOne(
                    { _id: `${sessionId}:meta` },
                    { $set: { value: { jid: conn.user?.id, linkedAt: Date.now() } } },
                    { upsert: true }
                );
            } catch {}
        }

        if (connection === "close") {
            session.socketReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ [${sessionId}] closed (${code})`);

            if (code === 401 || code === DisconnectReason.loggedOut) {
                global.sessions.delete(sessionId);
                await collection.deleteMany({ _id: { $regex: `^${sessionId}:` } });
                console.log(`🗑️ [${sessionId}] Session deleted from DB.`);
                return;
            }
            if (code === 440) return;

            setTimeout(() => {
                if (!global.sessions.has(sessionId)) return;
                bootSocket(sessionId, session).catch(e => console.error(`Reconnect ${sessionId}:`, e.message));
            }, 5000);
        }
    });

    conn.ev.on("messages.upsert", async (m) => {
        try {
            await handler(conn, m, { userId: sessionId, config, helpers: {}, services: {} });
        } catch (err) {
            console.error(`[${sessionId}] handler error:`, err.stack || err.message);
        }
    });

    return conn;
}

async function requestPairingCode(sessionId, phoneNumber) {
    await initMongo();
    let session = global.sessions.get(sessionId);

    if (session?.conn?.user) throw new Error("This session is already paired.");
    if (session?.pairing && session.pairingNumber === phoneNumber) return session.pairing;

    if (!session) {
        session = { conn: null, socketReady: false, pairing: null, pairingNumber: null };
        global.sessions.set(sessionId, session);
        await bootSocket(sessionId, session);
    }

    const deadline = Date.now() + 30000;
    while (!session.socketReady && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
    }
    if (!session.socketReady) throw new Error("Socket busy. Try again.");

    let code;
    try {
        code = await session.conn.requestPairingCode(phoneNumber);
    } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
        code = await session.conn.requestPairingCode(phoneNumber);
    }

    const formatted = code.match(/.{1,4}/g)?.join("-") || code;
    session.pairing = formatted;
    session.pairingNumber = phoneNumber;
    console.log(`✅ [${sessionId}] pairing code: ${formatted}`);
    return formatted;
}

// ============================================================
// 5. WEB ENDPOINTS
// ============================================================
app.get("/api/pair", async (req, res) => {
    const sessionId = String(req.query.sessionId || "").trim();
    const num = String(req.query.num || "").replace(/[^0-9]/g, "");

    if (!sessionId) return res.status(400).json({ error: "Provide ?sessionId=..." });
    if (!num || num.length < 10 || num.length > 15) {
        return res.status(400).json({ error: "Invalid phone number" });
    }

    try {
        const code = await new Promise((resolve, reject) => {
            pairingQueue = pairingQueue.then(() => requestPairingCode(sessionId, num)).then(resolve).catch(reject);
        });
        res.json({ success: true, sessionId, code });
    } catch (e) {
        console.error("Pair error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/status/:phone", (req, res) => {
    const phone = req.params.phone.replace(/\D/g, "");
    const session = global.sessions.get(phone);
    res.json({
        connected: session?.socketReady || false,
        code: session?.pairing || null,
        dbConnected: mongoose.connection.readyState === 1
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        activeSessions: global.sessions.size,
        dbConnected: mongoose.connection.readyState === 1
    });
});

// ============================================================
// 6. RESUME & BOOT
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
});

async function resumeAllSessions() {
    try {
        await initMongo();
        const c = authStateCollection();
        const metas = await c.find({ _id: { $regex: ":meta$" } }).toArray();
        
        if (metas.length > 0) {
            console.log(`🔄 Resuming ${metas.length} valid session(s)...`);
            for (const meta of metas) {
                const sessionId = meta._id.replace(/:meta$/, "");
                if (global.sessions.has(sessionId)) continue;

                const session = { conn: null, socketReady: false, pairing: null, pairingNumber: null };
                global.sessions.set(sessionId, session);

                try {
                    await bootSocket(sessionId, session);
                } catch (e) {
                    console.error(`Resume ${sessionId}:`, e.message);
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        } else {
            console.log(`📭 No linked sessions found. Waiting for new pairings...`);
        }
    } catch (e) {
        console.log("No sessions found to resume.");
    }
}

if (config.mongodb) {
    mongoose.connect(config.mongodb)
        .then(async () => {
            console.log("✅ Mongoose Connected");
            await resumeAllSessions();
        })
        .catch(e => {
            console.error("❌ Mongoose Error:", e.message);
            process.exit(1);
        });
} else {
    console.error("❌ MONGODB_URI is required in .env!");
    process.exit(1);
}

// Keep-Alive Ping to prevent Heroku from sleeping
setInterval(() => {
    console.log("💓 Keep-Alive Ping");
}, 1000 * 60 * 20); // Every 20 minutes