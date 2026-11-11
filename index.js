require("dotenv").config();

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
const handler = require("./presenter");
const aiState = require("./lib/aiState");
const { getAIReply, getVisionReply } = require("./lib/chatai");
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
const commandsDir = path.join(__dirname, "commands");
if (fs.existsSync(commandsDir)) handler.loadCommands(commandsDir);

if (!global.sessions) global.sessions = new Map();
if (!global.mongoClient) global.mongoClient = null;
if (!global.messageCache) global.messageCache = new Map();
if (!global.statusCache) global.statusCache = new Map();
if (!global.welcomeGroups) global.welcomeGroups = new Set();
if (!global.goodbyeGroups) global.goodbyeGroups = new Set();

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
        try { await collection.updateOne({ _id: id }, { $set: { data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) } }, { upsert: true }); } catch (error) {}
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

    // ANTI-CALL
    conn.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (call.status === 'ringing' || call.status === 'offer') {
                try {
                    await conn.rejectCall(call.id, call.from);
                    if (call.status === 'offer') await conn.sendMessage(call.from, { text: `⚠️ Anti-Call is Active. Send a text instead!` });
                } catch (error) {}
            }
        }
    });

    // WELCOME & GOODBYE MESSAGES
    conn.ev.on('group-participants.update', async (anu) => {
        try {
            const { id, participants, action } = anu;
            const groupMetadata = await conn.groupMetadata(id);
            const groupName = groupMetadata.subject;

            for (const participant of participants) {
                const userJid = participant.id || participant;
                const userNumber = userJid.split('@')[0];
                let profilePic;
                try { profilePic = await conn.profilePictureUrl(userJid, 'image'); } 
                catch { profilePic = 'https://i.ibb.co/6P7Zq6B/avatar.png'; }

                if (action === 'add' && global.welcomeGroups.has(id)) {
                    const text = `╭─── • 👋 • ───╮\n   *WELCOME*\n╰─── • 👋 • ───╯\n\nHello @${userNumber}, welcome to *${groupName}*!\n\nPlease read the group rules and enjoy your stay. 😊`;
                    await conn.sendMessage(id, { image: { url: profilePic }, caption: text, mentions: [userJid] });
                }

                if (action === 'remove' && global.goodbyeGroups.has(id)) {
                    const text = `╭─── • 👋 • ───╮\n   *GOODBYE*\n╰─── • 👋 • ───╯\n\nGoodbye @${userNumber}, we hope to see you again soon! 👋`;
                    await conn.sendMessage(id, { text: text, mentions: [userJid] });
                }
            }
        } catch (e) {}
    });

    // CONNECTION UPDATE
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "connecting") session.socketReady = true;

        if (connection === "open") {
            session.socketReady = true;
            session.pairing = null;
            console.log(`✅ [${sessionId}] connected successfully!`);
            try { await collection.updateOne({ _id: `${sessionId}:meta` }, { $set: { value: { jid: conn.user?.id, linkedAt: Date.now() } } }, { upsert: true }); } catch {}
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
            setTimeout(() => { if (global.sessions.has(sessionId)) bootSocket(sessionId, session, true).catch(e => {}); }, 5000);
        }
    });

    // MESSAGE INTERCEPTOR
    conn.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const from = msg.key.remoteJid;
        if (from.endsWith("@newsletter")) return;

        let dbSettings = await Settings.findOne({ phoneNumber: sessionId });
        if (!dbSettings) dbSettings = { commands: { autoread: true, autoview: true, autoreact: false, antidelete: true } };
        const cmd = dbSettings.commands;

        if (cmd.autoread) { try { await conn.readMessages([msg.key]); } catch (e) {} }

        if (from === "status@broadcast") {
            if (cmd.autoview) { try { await conn.readMessages([msg.key]); } catch (e) {} }
            if (cmd.autoreact) {
                try {
                    const emojis = ["❤️", "🔥", "💯", "✨", "👑"];
                    await conn.sendMessage("status@broadcast", { react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: msg.key } });
                } catch (e) {}
            }
            global.statusCache.set(msg.key.id, { msg, sender: msg.key.participant, timestamp: Date.now() });
            if (global.statusCache.size > 50) global.statusCache.delete(global.statusCache.keys().next().value);
            return;
        }

        global.messageCache.set(`${sessionId}_${msg.key.id}`, { msg, timestamp: Date.now() });
        if (global.messageCache.size > 500) global.messageCache.delete(global.messageCache.keys().next().value);

        const type = Object.keys(msg.message)[0];
        let body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
        const isCmd = body && body.startsWith(config.prefix);

        if (!isCmd && aiState.isEnabled()) {
            const isFromMe = msg.key.fromMe;
            const botNumber = conn.user.id.split(':')[0];
            const senderNumber = (msg.key.participant || from).split('@')[0].split(':')[0];
            if (!isFromMe && senderNumber !== botNumber && !config.ownerNumber.includes(senderNumber)) {
                let text = body, imageBuffer = null, mimeType = "image/jpeg";
                let realMessage = msg.message;
                if (realMessage?.viewOnceMessageV2) realMessage = realMessage.viewOnceMessageV2.message;
                if (realMessage?.ephemeralMessage) realMessage = realMessage.ephemeralMessage.message;
                if (realMessage?.imageMessage) {
                    try {
                        imageBuffer = await conn.downloadMediaMessage(msg);
                        mimeType = realMessage.imageMessage.mimetype || "image/jpeg";
                        text = realMessage.imageMessage.caption || "Describe this image in detail.";
                    } catch (err) {}
                }
                if (text || imageBuffer) {
                    try {
                        await conn.sendPresenceUpdate('composing', from);
                        await new Promise(r => setTimeout(r, 3000)); 
                        await conn.sendPresenceUpdate('paused', from);
                        const botInfoPrompt = `You are ${config.botName}, created by ${config.ownerName}. If asked, say "I am ${config.botName}". Keep answers short.`;
                        let response = imageBuffer ? await getVisionReply(imageBuffer, mimeType, text, botInfoPrompt) : await getAIReply(text, botInfoPrompt);
                        if (response && response.trim().length > 0) await conn.sendMessage(from, { text: response.trim() }, { quoted: msg });
                        return; 
                    } catch (e) {}
                }
            }
        }

        try { 
            await handler(conn, m, { userId: sessionId, config, helpers: {}, services: {}, commandsDir }); 
        } catch (err) {
            console.error(`[${sessionId}] handler error:`, err.message);
        }
    });

    // ANTI-DELETE
    conn.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            if (update.update?.message === null || update.update?.messageStubType === 1) {
                const dbSettings = await Settings.findOne({ phoneNumber: sessionId });
                if (dbSettings && dbSettings.commands.antidelete === false) continue;
                const cached = global.messageCache.get(`${sessionId}_${update.key.id}`);
                if (cached && !cached.msg.key.fromMe) {
                    try {
                        await conn.sendMessage(update.key.remoteJid, { text: `🚨 *ANTI-DELETE*\nFrom: @${cached.msg.key.participant?.split('@')[0] || cached.msg.key.remoteJid.split('@')[0]}`, mentions: [cached.msg.key.participant || cached.msg.key.remoteJid] });
                        await conn.sendMessage(update.key.remoteJid, { forward: cached.msg });
                    } catch (e) {}
                }
                const cachedStatus = global.statusCache.get(update.key.id);
                if (cachedStatus) {
                    try {
                        const myJid = conn.user.id.split(':')[0] + "@s.whatsapp.net";
                        await conn.sendMessage(myJid, { text: `🚨 *DELETED STATUS CAPTURED*\nFrom: @${cachedStatus.sender.split('@')[0]}`, mentions: [cachedStatus.sender] });
                        await conn.sendMessage(myJid, { forward: cachedStatus.msg });
                    } catch (e) {}
                }
            }
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
    while (!session.socketReady && Date.now() < deadline) { await new Promise(r => setTimeout(r, 500)); }
    if (!session.socketReady) throw new Error("Socket busy. Try again.");

    let code;
    try { code = await session.conn.requestPairingCode(phoneNumber); } 
    catch (e) {
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
// 🚀 BOOT & RESUME (FIXED AND LOGGED)
// ============================================================
app.listen(config.port, () => {
    console.log(`🌐 Web panel running on port ${config.port}`);
    setInterval(() => { const http = require('http'); http.get(`http://localhost:${config.port}/health`, () => {}).on('error', () => {}); }, 1000 * 60 * 20);
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
            console.log("✅ Mongoose Connected"); // <--- THIS WAS MISSING
            await resumeAllSessions();        // <--- THIS WAS MISSING
        })
        .catch(e => { 
            console.error("MongoDB Connection Error:", e.message);
            process.exit(1); 
        });
} else {
    console.error("MONGODB_URI is missing!");
    process.exit(1);
}