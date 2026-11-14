// lib/autoToggles.js
// Runtime on/off state for auto-detection features.
// Persisted in MongoDB. Fast in-memory cache.

const mongoose = require("mongoose");

const AutoToggleSchema = new mongoose.Schema({
    sessionId: { type: String, default: "*", index: true, required: true },
    feature:   { type: String, required: true, index: true },
    groupJid:  { type: String, default: null, index: true },
    enabled:   { type: Boolean, default: false }
}, { timestamps: true });

// Unique compound index
AutoToggleSchema.index(
    { sessionId: 1, feature: 1, groupJid: 1 },
    { unique: true }
);

const AutoToggle = mongoose.models.AutoToggle ||
    mongoose.model("AutoToggle", AutoToggleSchema);

// ---- Known auto features ----
const FEATURES = [
    "antidelete",
    "antilink",
    "antimedia",
    "antibug",
    "antispam",
    "anticall",
    "autoread",
    "autoreact",
    "autosave",
    "autogreet",
    "welcome",
    "goodbye",
    "statusview",
    "statuslike",
    "statusreply",
    "autoblock",
    "autosubscribe",
    // Antimedia sub-types
    "antimedia_photo",
    "antimedia_video",
    "antimedia_sticker",
    "antimedia_audio",
    "antimedia_voice",
    "antimedia_document",
    "antimedia_status"
];

// ---- Cache ----
const cache = new Map();   
let loadedAt = 0;
const CACHE_TTL = 10000;   

function cacheKey(sessionId, feature, groupJid) {
    return `${sessionId || "*"}:${feature}:${groupJid || ""}`;
}

function cacheSet(sessionId, feature, groupJid, value) {
    cache.set(cacheKey(sessionId, feature, groupJid), !!value);
}

function cacheGet(sessionId, feature, groupJid) {
    return cache.get(cacheKey(sessionId, feature, groupJid));
}

function cacheHas(sessionId, feature, groupJid) {
    return cache.has(cacheKey(sessionId, feature, groupJid));
}

async function refreshCache() {
    try {
        const docs = await AutoToggle.find({}).lean();
        cache.clear();
        for (const d of docs) {
            if (!FEATURES.includes(d.feature)) continue;
            cacheSet(d.sessionId, d.feature, d.groupJid, d.enabled);
        }
        loadedAt = Date.now();
        return cache;
    } catch (e) {
        console.error("[autoToggles] refreshCache:", e.message);
        return cache;
    }
}

async function get(sessionId, feature, groupJid = null, defaultValue = false) {
    if (!FEATURES.includes(feature)) return !!defaultValue;

    if (loadedAt === 0) {
        try { await refreshCache(); } catch {}
    }

    if (groupJid && cacheHas(sessionId, feature, groupJid)) {
        return cacheGet(sessionId, feature, groupJid);
    }

    if (cacheHas(sessionId, feature, null)) {
        return cacheGet(sessionId, feature, null);
    }

    if (cacheHas("*", feature, null)) {
        return cacheGet("*", feature, null);
    }

    try {
        const config = require("../config");
        if (typeof config[feature] === "boolean") return config[feature];
    } catch {}

    return !!defaultValue;
}

async function set(sessionId, feature, groupJid = null, value = false) {
    if (!FEATURES.includes(feature)) {
        console.warn(`[autoToggles] set() unknown feature: ${feature} — ignoring`);
        return false;
    }
    sessionId = sessionId || "*";
    groupJid = groupJid || null;

    try {
        await AutoToggle.updateOne(
            { sessionId, feature, groupJid },
            { $set: { enabled: !!value } },
            { upsert: true }
        );
        cacheSet(sessionId, feature, groupJid, value);
        return true;
    } catch (e) {
        console.error(`[autoToggles] set(${sessionId}, ${feature}, ${groupJid}):`, e.message);
        cacheSet(sessionId, feature, groupJid, value);
        return false;
    }
}

function isEnabled(feature) {
    if (!FEATURES.includes(feature)) return false;
    if (cacheHas("*", feature, null)) return cacheGet("*", feature, null);
    try {
        const config = require("../config");
        if (typeof config[feature] === "boolean") return config[feature];
    } catch {}
    return false;
}

async function setEnabled(feature, enabled) {
    return set("*", feature, null, enabled);
}

async function getStatus(sessionId = null) {
    if (loadedAt === 0 || Date.now() - loadedAt > CACHE_TTL) {
        try { await refreshCache(); } catch {}
    }

    const out = {};
    for (const f of FEATURES) {
        if (sessionId === null) {
            out[f] = isEnabled(f);
        } else {
            if (cacheHas(sessionId, f, null)) out[f] = cacheGet(sessionId, f, null);
            else if (cacheHas("*", f, null)) out[f] = cacheGet("*", f, null);
            else out[f] = isEnabled(f);
        }
    }
    return out;
}

// Boot + auto-refresh
setTimeout(() => refreshCache().catch(() => {}), 3000);
setInterval(() => refreshCache().catch(() => {}), CACHE_TTL).unref();

module.exports = {
    get,
    set,
    isEnabled,
    setEnabled,
    getStatus,
    refreshCache,
    clearCache: () => { cache.clear(); loadedAt = 0; },
    FEATURES,
    AutoToggle
};