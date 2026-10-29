const { proto } = require("@whiskeysockets/baileys");
const { mongoose } = require("mongoose");

// In-memory cache so we don't spam the DB for every single message
const memoryStore = new Map();

const SessionSchema = new mongoose.Schema({
    _id: String, // phone number or session ID
    creds: Object,
    keys: Object
});
const MongoSession = mongoose.models.MongoSession || mongoose.model("MongoSession", SessionSchema);

async function useMongoAuthState(sessionId) {
    let creds, keys = {};

    // 1. Try memory first
    if (memoryStore.has(sessionId)) {
        const mem = memoryStore.get(sessionId);
        creds = mem.creds;
        keys = mem.keys;
    } else {
        // 2. Try Database
        const doc = await MongoSession.findById(sessionId);
        if (doc) {
            creds = doc.creds;
            keys = doc.keys;
        } else {
            creds = null;
            keys = {};
        }
    }

    // 3. Default initial creds if none exist
    if (!creds) {
        creds = {
            noiseKey: null,
            pairingEphemeralKeyPair: null,
            signedIdentityKey: null,
            signedPreKey: null,
            registrationId: 0,
            advSecretKey: "",
            processedHistoryMessages: [],
            nextPreKeyId: 1,
            firstUnuploadedPreKeyId: 1,
            accountSettings: { unarchiveChats: false }
        };
    }

    const saveState = async () => {
        memoryStore.set(sessionId, { creds, keys });
        await MongoSession.findByIdAndUpdate(sessionId, { creds, keys }, { upsert: true });
    };

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        data[id] = keys[type]?.[id];
                    }
                    return data;
                },
                set: (data) => {
                    keys = { ...keys, ...data };
                    // Save in background to avoid blocking
                    saveState().catch(console.error);
                }
            }
        },
        saveCreds: saveState
    };
}

module.exports = { useMongoAuthState, MongoSession };