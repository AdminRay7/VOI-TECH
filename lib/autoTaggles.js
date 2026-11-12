// lib/autoToggles.js
// Runtime on/off state for auto-detection features.
// Persisted in MongoDB. Fast in-memory cache.

const mongoose = require("mongoose");

const AutoToggleSchema = new mongoose.Schema({
    key:       { type: String, unique: true, index: true, required: true },
    enabled:   { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

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
    "autosubscribe"
];

// ---- Cache ----
const cache = new Map();   // feature -> bool
let loadedAt = 0;
const CACHE_TTL = 10000;   // 10s

async function refreshCache() {
    try {
        const docs = await AutoToggle.find({}).lean();
        cache.clear();
        for (const d of docs) cache.set(d.key, !!d.enabled);
        loadedAt = Date.now();
        return cache;
    } catch (e) {
        console.error("[autoToggles] refreshCache:", e.message);
        return cache;
    }
}

function isEnabled(feature) {
    if (cache.has(feature)) return cache.get(feature);
    try {
        const config = require("../config");
        if (typeof config[feature] === "boolean") return config[feature];
    } catch {}
    return false;
}

async function setEnabled(feature, enabled) {
    if (!FEATURES.includes(feature)) throw new Error(`Unknown feature: ${feature}`);
    await AutoToggle.updateOne(
        { key: feature },
        { $set: { enabled: !!enabled, updatedAt: new Date() } },
        { upsert: true }
    );
    cache.set(feature, !!enabled);
    return true;
}

// ==========================================
// NEW FUNCTIONS: For session-based toggles
// ==========================================

async function get(sessionId, feature, scope = null, fallback = false) {
    const key = sessionId ? `${sessionId}:${feature}` : feature;
    if (cache.has(key)) return cache.get(key);
    
    try {
        const doc = await AutoToggle.findOne({ key }).lean();
        if (doc) {
            cache.set(key, !!doc.enabled);
            return !!doc.enabled;
        }
    } catch (e) {}
    
    // Fallback to global if session toggle not found
    return isEnabled(feature) || fallback;
}

async function set(sessionId, feature, scope = null, value = false) {
    const key = sessionId ? `${sessionId}:${feature}` : feature;
    await AutoToggle.updateOne(
        { key: key },
        { $set: { enabled: !!value, updatedAt: new Date() } },
        { upsert: true }
    );
    cache.set(key, !!value);
    return true;
}

async function getStatus() {
    await refreshCache();
    const out = {};
    for (const f of FEATURES) out[f] = isEnabled(f);
    return out;
}

// Boot + auto-refresh
setTimeout(() => refreshCache().catch(() => {}), 3000);
setInterval(() => refreshCache().catch(() => {}), CACHE_TTL).unref();

module.exports = {
    FEATURES,
    isEnabled,
    setEnabled,
    get,
    set,
    getStatus,
    refreshCache,
    AutoToggle
};