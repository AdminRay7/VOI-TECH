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
const aiState = require("./lib/aiState");
const { getAIReply, getVisionReply } = require("./lib/chatai");

const app = express();
app.use(express.json());

// ============================================================
// WEB ROUTES
// ============================================================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/index.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// AI WEB APIs
// ============================================================
app.post("/api/ai/toggle", (req, res) => {
    const { enabled } = req.body;
    aiState.setEnabled(enabled);
    console.log(`🤖 AI Auto-Reply turned ${enabled ? "ON" : "OFF"} from Web Panel`);
    res.json({ success: true, enabled });
});

app.post("/api/ai/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    try {
        const reply = await getAIReply(message);
        res.json({ reply });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// LOAD COMMANDS
// ============================================================
const commandsDir = path.join(__dirname, "commands");
if (fs.existsSync(commandsDir)) {
    handler.loadCommands(commandsDir);
}

// ============================================================
// MONGODB AUTH STATE
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
// GLOBAL STATE & DB INIT
// ============================================================
if (!global.sessions) global.sessions = new Map();
if (!global.mongoClient) global.mongoClient = null;
let pairingQueue = Promise.resolve();
let isFirstBoot = true;

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
// PAIRING & BOOT LOGIC
// ============================================================
async function bootSocket(sessionId, session) {
    await initMongo();
    const collection = authStateCollection();
    const { state: waState, saveCreds } = await useMongoDBAuthState(collection, sessionId);
    const { version } = await fetchLatestBaileysVersion();

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
        markOnlineOnConnect: true, 
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000, 
        fireInitQueries: !isNewSession, 
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

            try {
                const jid = conn.user.id.split(':')[0] + "@s.whatsapp.net";
                const now = Date.now();
                const lastSeen = session.lastSeen || 0;
                const isReconnect = (now - lastSeen) < 60000; 

                if (isNewSession && isFirstBoot) {
                    await conn.sendMessage(jid, { text: `╭─── • 🔑 • ───╮\n   *${config.botName}* ᴠ${config.version}\n╰─── • 🔑 • ───╯\n\n👋 *Welcome!* Your session has been successfully linked.\n\nType *${config.prefix}menu* to see my commands.` });
                } 
                else if (!isNewSession && !isFirstBoot && !isReconnect) {
                    await conn.sendMessage(jid, { text: `╭─── • 🔄 • ───╮\n   *${config.botName}* ᴠ${config.version}\n╰─── • 🔄 • ───╯\n\n♻️ *System Restarted*\nI am back online!` });
                }
                session.lastSeen = Date.now();
            } catch (e) {}
        }

        if (connection === "close") {
            session.socketReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ [${sessionId}] closed (${code})`);

            if (code === 401 || code === DisconnectReason.loggedOut) {
                global.sessions.delete(sessionId);
                await collection.deleteMany({ _id: { $regex: `^${sessionId}:` } });
                return;
            }
            if (code === 440) return;

            setTimeout(() => {
                if (!global.sessions.has(sessionId)) return;
                bootSocket(sessionId, session).catch(e => console.error(`Reconnect ${sessionId}:`, e.message));
            }, 5000);
        }
    });

    // ============================================================
    // MESSAGE INTERCEPTOR (AI vs COMMANDS)
    // ============================================================
    conn.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        if (from.endsWith("@newsletter")) return;

        // Extract body for command checking
        const type = Object.keys(msg.message)[0];
        let body = "";
        if (type === "conversation") body = msg.message.conversation || "";
        if (type === "extendedTextMessage") body = msg.message.extendedTextMessage?.text || "";
        if (type === "imageMessage") body = msg.message.imageMessage?.caption || "";

        const isCmd = body && body.startsWith(config.prefix);

        // --------------------------------------------------------
        // 1. AI AUTO-REPLY HANDLING
        // --------------------------------------------------------
        if (!isCmd && aiState.isEnabled()) {
            // Block Owner & Bot
            const isFromMe = msg.key.fromMe;
            const botNumber = conn.user.id.split(':')[0];
            const senderNumber = (msg.key.participant || from).split('@')[0].split(':')[0];
            
            if (!isFromMe && senderNumber !== botNumber && !config.ownerNumber.includes(senderNumber)) {
                
                let text = body;
                let imageBuffer = null;
                let mimeType = "image/jpeg";

                // Deep Unwrap
                let realMessage = msg.message;
                if (realMessage?.viewOnceMessageV2) realMessage = realMessage.viewOnceMessageV2.message;
                if (realMessage?.viewOnceMessage) realMessage = realMessage.viewOnceMessage.message;
                if (realMessage?.ephemeralMessage) realMessage = realMessage.ephemeralMessage.message;
                if (realMessage?.documentWithCaptionMessage) realMessage = realMessage.documentWithCaptionMessage.message;

                const imageMsg = realMessage?.imageMessage;
                if (imageMsg) {
                    try {
                        imageBuffer = await conn.downloadMediaMessage(msg);
                        mimeType = imageMsg.mimetype || "image/jpeg";
                        text = imageMsg.caption || "Describe this image in detail.";
                    } catch (err) {}
                }

                if (text || imageBuffer) {
                    try {
                        await conn.sendPresenceUpdate('composing', from);
                        await new Promise(resolve => setTimeout(resolve, 3000)); 
                        await conn.sendPresenceUpdate('paused', from);

                        let response;
                        if (imageBuffer) {
                            response = await getVisionReply(imageBuffer, mimeType, text);
                        } else {
                            response = await getAIReply(text);
                        }

                        if (response && response.trim().length > 0) {
                            await conn.sendMessage(from, { text: response.trim() }, { quoted: msg });
                        }
                        return; // STOP! We replied with AI, do not run commands.
                    } catch (e) {
                        console.error(`[AI Error] ${e.message}`);
                    }
                }
            }
        }

        // --------------------------------------------------------
        // 2. PASS TO PRESENTER (Commands & Games)
        // --------------------------------------------------------
        try {
            await handler(conn, m, { 
                userId: sessionId, 
                config, 
                helpers: {}, 
                services: {},
                commandsDir: path.join(__dirname, "commands") 
            });
        } catch (err) {
            console.error(`[${sessionId}] presenter error:`, err.message);
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
        session = { conn: null, socketReady: false, pairing: null, pairingNumber: null, lastSeen: 0 };
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
    return formatted;
}

// ============================================================
// WEB ENDPOINTS
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
        res.status(500).json({ error: e.message });
    }
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        activeSessions: global.sessions.size,
        dbConnected: mongoose.connection.readyState === 1
    });
});

// ============================================================
// BOOT
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
    setInterval(() => {
        const http = require('http');
        http.get(`http://localhost:${config.port}/health`, () => {}).on('error', () => {});
    }, 1000 * 60 * 20);
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

                const session = { conn: null, socketReady: false, pairing: null, pairingNumber: null, lastSeen: 0 };
                global.sessions.set(sessionId, session);

                try {
                    await bootSocket(sessionId, session);
                } catch (e) {}
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } catch (e) {}
}

if (config.mongodb) {
    mongoose.connect(config.mongodb)
        .then(async () => {
            console.log("✅ Mongoose Connected");
            await resumeAllSessions();
        })
        .catch(e => { process.exit(1); });
} else {
    process.exit(1);
}
