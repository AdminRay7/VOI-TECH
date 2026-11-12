// lib/aiSettings.js
// Runtime AI on/off toggle (persisted in MongoDB).
// Lets the admin enable/disable AI from the dashboard without restart.
// Provides a fast in-memory cache so the handler doesn't hit MongoDB
// on every incoming message.

const mongoose = require("mongoose");

// ============================================================
//   SCHEMA — key-value store in "settings" collection
// ============================================================
const SettingSchema = new mongoose.Schema({
    key:       { type: String, unique: true, index: true, required: true },
    value:     mongoose.Schema.Types.Mixed,
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Setting = mongoose.models.Setting ||
    mongoose.model("Setting", SettingSchema);

// ============================================================
//   LOW-LEVEL GET / SET
// ============================================================
async function get(key, fallback = null) {
    try {
        const doc = await Setting.findOne({ key }).lean();
        return doc ? doc.value : fallback;
    } catch (e) {
        console.error("[aiSettings] get error:", e.message);
        return fallback;
    }
}

async function set(key, value) {
    try {
        await Setting.updateOne(
            { key },
            { $set: { value, updatedAt: new Date() } },
            { upsert: true }
        );
        return true;
    } catch (e) {
        console.error("[aiSettings] set error:", e.message);
        return false;
    }
}

// ============================================================
//   CONVENIENCE WRAPPERS
// ============================================================
async function getAiEnabled() {
    // null means "not set in DB" → caller should fall back to config
    return await get("ai_enabled", null);
}

async function setAiEnabled(value) {
    return await set("ai_enabled", !!value);
}

async function getAiGroupsEnabled() {
    return await get("ai_groups_enabled", null);
}

async function setAiGroupsEnabled(value) {
    return await set("ai_groups_enabled", !!value);
}

// ============================================================
//   STATUS — combine DB value + config fallback
// ============================================================
async function getStatus() {
    let config = {};
    try { config = require("../config"); } catch {}

    const enabled = await getAiEnabled();
    const groups  = await getAiGroupsEnabled();

    return {
        enabled:       enabled === null ? !!config.aiChatEnabled : !!enabled,
        groupsEnabled: groups  === null ? !!config.aiChatGroups  : !!groups,
        source: {
            enabled:       enabled === null ? "config" : "db",
            groupsEnabled: groups  === null ? "config" : "db"
        }
    };
}

// ============================================================
//   FAST CACHE
//   Handler calls isEnabledCached() on every message.
//   Cache refreshes every 10 seconds (and immediately on toggle).
// ============================================================
let cache = {
    enabled:        null,
    groupsEnabled:  null,
    loadedAt:       0
};

async function refreshCache() {
    try {
        const s = await getStatus();
        cache.enabled       = s.enabled;
        cache.groupsEnabled = s.groupsEnabled;
        cache.loadedAt      = Date.now();
        return s;
    } catch (e) {
        console.error("[aiSettings] refreshCache:", e.message);
        return cache;
    }
}

function isEnabledCached() {
    return cache.enabled !== null ? cache.enabled : true;
}

function isGroupsEnabledCached() {
    return cache.groupsEnabled !== null ? cache.groupsEnabled : true;
}

// ============================================================
//   BOOT + AUTO-REFRESH
// ============================================================
// Load on startup (after a small delay to let Mongo connect)
setTimeout(() => { refreshCache().catch(() => {}); }, 3000);

// Auto-refresh every 10s — keeps cache in sync if changed elsewhere
setInterval(() => { refreshCache().catch(() => {}); }, 10000).unref();

// ============================================================
//   EXPORTS
// ============================================================
module.exports = {
    // raw
    get,
    set,

    // ai specific
    getAiEnabled,
    setAiEnabled,
    getAiGroupsEnabled,
    setAiGroupsEnabled,

    // status
    getStatus,
    refreshCache,

    // cache reads (fast, for handler)
    isEnabledCached,
    isGroupsEnabledCached,

    // model
    Setting
};