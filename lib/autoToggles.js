// lib/autoToggles.js
// Runtime on/off state for auto-detection features.
// Persisted in MongoDB. Fast in-memory cache.
//
// API:
//   get(sessionId, feature, groupJid?, defaultValue?)  -> Promise<boolean>
//   set(sessionId, feature, groupJid?, value)          -> Promise<boolean>
//   isEnabled(feature)                                 -> boolean (sync, global-only legacy)
//   setEnabled(feature, value)                         -> Promise<boolean> (global legacy)
//   getStatus(sessionId?)                              -> Promise<{feature: bool}>
//   refreshCache()                                     -> Promise<Map>
//   clearCache()                                       -> void
//   FEATURES                                           -> string[]
//   AutoToggle                                         -> Mongoose model

const mongoose = require("mongoose");

// ============================================================
//   SCHEMA — per-session, per-group scoping
// ============================================================
// Precedence at read time:
//   1. Exact (sessionId, feature, groupJid)
//   2. Session-global (sessionId, feature, groupJid=null)
//   3. Global-global (sessionId="*", feature, groupJid=null)
//   4. config[feature]
//   5. defaultValue (or false)
//
// groupJid = null → global default for that session
// sessionId = "*" → applies to all sessions (fallback tier 3)

const AutoToggleSchema = new mongoose.Schema({
    sessionId: { type: String, default: "*", index: true, required: true },
    feature:   { type: String, required: true, index: true },
    groupJid:  { type: String, default: null, index: true },
    enabled:   { type: Boolean, default: false }
}, { timestamps: true });

// Unique compound index — replaces the old `unique: true` on `key`
AutoToggleSchema.index(
    { sessionId: 1, feature: 1, groupJid: 1 },
    { unique: true }
);

const AutoToggle = mongoose.models.AutoToggle ||
    mongoose.model("AutoToggle", AutoToggleSchema);

// ============================================================
//   KNOWN FEATURES (whitelist)
// ============================================================
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

// ============================================================
//   CACHE — key format: `${sessionId}:${feature}:${groupJid||''}`
// ============================================================
const cache = new Map();
let loadedAt = 0;
const CACHE_TTL = 10_000; // 10s cross-process staleness

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

// ============================================================
//   REFRESH
// ============================================================
async function refreshCache() {
    try {
        const docs = await AutoToggle.find({}).lean();
        cache.clear();
        for (const d of docs) {
            // Only load whitelisted features
            if (!FEATURES.includes(d.feature)) continue;
            cacheSet(d.sessionId, d.feature, d.groupJid, d.enabled);
        }
        loadedAt = Date.now();
        return cache;
    } catch (e) {
        console.error("[autoToggles] refreshCache:", e.message);
        return cache; // keep stale cache on failure
    }
}

function clearCache() {
    cache.clear();
    loadedAt = 0;
}

// ============================================================
//   GET — resolution with fallback chain
// ============================================================
async function get(sessionId, feature, groupJid = null, defaultValue = false) {
    // Guard: skip entirely for unknown features
    if (!FEATURES.includes(feature)) return !!defaultValue;

    // If cache never loaded, try loading once (non-blocking failure)
    if (loadedAt === 0) {
        try { await refreshCache(); } catch {}
    }

    // Tier 1: exact (session, feature, group)
    if (groupJid && cacheHas(sessionId, feature, groupJid)) {
        return cacheGet(sessionId, feature, groupJid);
    }

    // Tier 2: session-global (session, feature, null)
    if (cacheHas(sessionId, feature, null)) {
        return cacheGet(sessionId, feature, null);
    }

    // Tier 3: global-global ("*", feature, null)
    if (cacheHas("*", feature, null)) {
        return cacheGet("*", feature, null);
    }

    // Tier 4: config
    try {
        const config = require("../config");
        if (typeof config[feature] === "boolean") return config[feature];
    } catch {}

    // Tier 5: default
    return !!defaultValue;
}

// ============================================================
//   SET
// ============================================================
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
        // Still update local cache so the current process is consistent
        cacheSet(sessionId, feature, groupJid, value);
        return false;
    }
}

// ============================================================
//   LEGACY SYNC API
// ============================================================
function isEnabled(feature) {
    if (!FEATURES.includes(feature)) return false;
    // Try global-global first, then config
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

// ============================================================
//   STATUS
// ============================================================
async function getStatus(sessionId = null) {
    // Refresh only if stale
    if (loadedAt === 0 || Date.now() - loadedAt > CACHE_TTL) {
        try { await refreshCache(); } catch {}
    }

    const out = {};
    for (const f of FEATURES) {
        if (sessionId === null) {
            out[f] = isEnabled(f);
        } else {
            // For per-session view, resolve with the same fallback chain
            if (cacheHas(sessionId, f, null)) out[f] = cacheGet(sessionId, f, null);
            else if (cacheHas("*", f, null)) out[f] = cacheGet("*", f, null);
            else out[f] = isEnabled(f);
        }
    }
    return out;
}

// ============================================================
//   BOOT + AUTO-REFRESH
// ============================================================
setTimeout(() => refreshCache().catch(() => {}), 1000).unref();
setInterval(() => refreshCache().catch(() => {}), CACHE_TTL).unref();

// ============================================================
//   EXPORTS
// ============================================================
module.exports = {
    // Primary API
    get,
    set,
    // Legacy API
    isEnabled,
    setEnabled,
    // Utility
    getStatus,
    refreshCache,
    clearCache,
    FEATURES,
    AutoToggle
};