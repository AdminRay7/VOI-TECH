require("dotenv").config();

// ============================================
//   Silence Baileys' known log spam
// ============================================
const _origConsoleError = console.error.bind(console);
const _origConsoleWarn  = console.warn.bind(console);

const _SILENCED_PATTERNS = [
    'Bad MAC', 'Bad RSA', 'doDecryptWhisperMessage', 'decryptWithSessions',
    'verifyMAC', 'Session error:Error: Bad MAC',
    'Failed to decrypt message with any known session',
    'unpadRandomMax16', 'Closing session',
    'Closing open session in favor of incoming preKey bundle',
    'Session already closed', 'Removing old closed session'
];

function _shouldSilence(args) {
    const first = args[0];
    if (typeof first !== 'string') return false;
    return _SILENCED_PATTERNS.some(p => first.includes(p));
}

console.error = (...args) => { if (!_shouldSilence(args)) _origConsoleError(...args); };
console.warn  = (...args) => { if (!_shouldSilence(args)) _origConsoleWarn(...args); };
// ============================================

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const pino = require("pino");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
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
const handler = require("./presenter"); // Your Enterprise Handler
const User = require("./models/User");
const Settings = require("./models/Settings");

const app = express();
app.use(express.json());

// ============================================================
// AUTHENTICATION API
// ============================================================
app.post("/api/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ error: "Email already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const role = (email.toLowerCase() === config.adminEmail.toLowerCase()) ? "admin" : "user";

        user = new User({ email, password: hashedPassword, role });
        await user.save();
        res.json({ success: true, message: "Registered successfully" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.json({ token, role: user.role });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ error: "Invalid token" });
    }
};

// ============================================================
// SETTINGS API
// ============================================================
app.get("/api/settings/:phone", authMiddleware, async (req, res) => {
    try {
        const settings = await Settings.findOne({ phoneNumber: req.params.phone });
        if (!settings) return res.json({ commands: {} }); 
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/settings/:phone", authMiddleware, async (req, res) => {
    try {
        const { commands } = req.body;
        await Settings.findOneAndUpdate({ phoneNumber: req.params.phone }, { $set: { commands } }, { upsert: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// WEB ROUTES
// ============================================================
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "public", "register.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname, "public", "settings.html")));
app.get("/pair", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ['html'] }));

// ============================================================
// BOT & DB INIT
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

async function useMongoDBAuthState(collection, sessionId) {
    const writeData = async (data, id) => {
        try { 
            await collection.updateOne({ _id: id }, { $set: { data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) } }, { upsert: true }); 
        } catch (error) { console.error("writeData error:", error.message); }
    };
    const readData = async (id) => {
        try {
            const doc = await collection.findOne({ _id: id });
            if (doc && doc.data) return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
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
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${sessionId}:${type}-${id}`);
                        if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        data[id] = value;
                    }));
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
        saveCreds: async () => { await writeData(creds, credsId); }
    };
}

async function bootSocket(sessionId, session, isResuming = false) {
    await initMongo();
    const collection = global.mongoClient.db("xmd303").collection("authState");
    const { state: waState, saveCreds } = await useMongoDBAuthState(collection, sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const isNewSession = !waState.creds.me;
    const conn = makeWASocket({
        version,
        auth: { creds: waState.creds, keys: makeCacheableSignalKeyStore(waState.keys, pino({ level: "silent" })) },
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

    // ============================================================
    // ROUTE EVENTS TO PRESENTER.JS
    // ============================================================
    
    // 1. Messages
    conn.ev.on("messages.upsert", async (m) => {
        try {
            await handler(conn, m, sessionId);
        } catch (err) {
            console.error(`[${sessionId}] handler error:`, err.message);
        }
    });

    // 2. Group Updates (Welcome/Goodbye, Antilink)
    conn.ev.on('group-participants.update', async (update) => {
        try {
            // FIX: Pass sessionId so auto-toggles match correctly
            await handler.handleGroupUpdate(conn, update, sessionId);
        } catch (e) { console.error("group-participants handler error:", e.message); }
    });

    // 3. Calls (Anti-Call)
    conn.ev.on('call', async (calls) => {
        try {
            // FIX: Pass sessionId
            await handler.handleCallEvent(conn, calls, sessionId);
        } catch (e) { console.error("call handler error:", e.message); }
    });

    // CONNECTION UPDATE
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "connecting") session.socketReady = true;

        if (connection === "open") {
            session.socketReady = true;
            session.pairing = null;
            console.log(`✅ [${sessionId}] connected successfully!`);
            try { 
                await collection.updateOne({ _id: `${sessionId}:meta` }, { $set: { value: { jid: conn.user?.id, linkedAt: Date.now() } } }, { upsert: true }); 
            } catch {}
            
            try {
                const cleanNumber = conn.user?.id.split(':')[0].split('@')[0];
                const jid = `${cleanNumber}@s.whatsapp.net`;
                if (isNewSession && !isResuming) await conn.sendMessage(jid, { text: `👋 Welcome! Session linked successfully.` });
                else if (isResuming) await conn.sendMessage(jid, { text: `♻️ System Restarted - Bot is online.` });
            } catch (e) {}
        }

        if (connection === "close") {
            session.socketReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ [${sessionId}] disconnected. Code: ${code}`);
            
            if (code === 401 || code === DisconnectReason.loggedOut) {
                global.sessions.delete(sessionId);
                await collection.deleteMany({ _id: { $regex: `^${sessionId}:` } });
                return;
            }
            if (code === 440) return;
            
            setTimeout(() => { 
                if (global.sessions.has(sessionId)) {
                    bootSocket(sessionId, session, true).catch(e => {}); 
                }
            }, 5000);
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
        await bootSocket(sessionId, session, false);
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

app.get("/api/pair", async (req, res) => {
    const sessionId = String(req.query.sessionId || "").trim();
    const num = String(req.query.num || "").replace(/[^0-9]/g, "");
    if (!sessionId) return res.status(400).json({ error: "Provide ?sessionId=..." });
    if (!num || num.length < 10 || num.length > 15) return res.status(400).json({ error: "Invalid phone number" });
    try {
        const code = await new Promise((resolve, reject) => {
            pairingQueue = pairingQueue.then(() => requestPairingCode(sessionId, num)).then(resolve).catch(reject);
        });
        res.json({ success: true, sessionId, code });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (req, res) => {
    res.json({ ok: true, activeSessions: global.sessions.size, dbConnected: mongoose.connection.readyState === 1 });
});

// ============================================================
// 🚀 BOOT & RESUME
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
    // Keep-awake ping
    setInterval(() => { 
        const http = require('http'); 
        http.get(`http://localhost:${config.port}/health`, () => {}).on('error', () => {}); 
    }, 1000 * 60 * 20);
});

async function resumeAllSessions() {
    try {
        await initMongo();
        const c = global.mongoClient.db("xmd303").collection("authState");
        const metas = await c.find({ _id: { $regex: ":meta$" } }).toArray();
        
        if (metas.length > 0) {
            console.log(`🔄 Resuming ${metas.length} valid session(s)...`);
            for (const meta of metas) {
                const sessionId = meta._id.replace(/:meta$/, "");
                if (global.sessions.has(sessionId)) continue;
                
                const session = { conn: null, socketReady: false, pairing: null, pairingNumber: null, lastSeen: 0 };
                global.sessions.set(sessionId, session);
                
                try { 
                    await bootSocket(sessionId, session, true); 
                } catch (e) {
                    console.error(`Failed to resume ${sessionId}:`, e.message);
                }
                // Small delay between boots to prevent rate-limiting from WhatsApp
                await new Promise(r => setTimeout(r, 2000));
            }
        } else {
            console.log(`📭 No linked sessions found. Waiting for new pairings...`);
        }
    } catch (e) {
        console.log("Error in resume logic:", e.message);
    }
}

if (config.mongodb) {
    mongoose.connect(config.mongodb)
        .then(async () => { 
            console.log("✅ Mongoose Connected"); 
            await resumeAllSessions();        
        })
        .catch(e => { 
            console.error("MongoDB Connection Error:", e.message);
            process.exit(1); 
        });
} else {
    console.error("MONGODB_URI is missing!");
    process.exit(1);
}