const mongoose = require("mongoose");

// ============================================================
//   CORE MODELS
// ============================================================

// ---- User (kept — matches your existing schema) ----
const UserSchema = new mongoose.Schema({
    jid:             { type: String, unique: true, index: true },
    name:            String,
    sessionId:       { type: String, index: true },
    lastActive:      Date,
    messageCount:    { type: Number, default: 0 },
    spamCount:       { type: Number, default: 0 },
    lastMessageTime: Number
}, { timestamps: true });

// ---- ChannelSubscriber (kept — matches your existing schema) ----
const ChannelSubscriberSchema = new mongoose.Schema({
    jid:          { type: String, unique: true, index: true },
    name:         String,
    subscribedAt: Date,
    lastActive:   Date,
    isActive:     { type: Boolean, default: true },
    autoFollow:   { type: Boolean, default: true }
}, { timestamps: true });

// ---- ChannelPost (kept — used by your index.js channel routes) ----
const ChannelPostSchema = new mongoose.Schema({
    msgId:     { type: String, index: true },
    serverId:  Number,
    jid:       { type: String, index: true },
    text:      String,
    type:      String,
    timestamp: { type: Date, index: true },
    raw:       Object
}, { timestamps: true });

// ============================================================
//   ACCOUNT SYSTEM  (used by the full-featured dashboard)
// ============================================================

const AccountSchema = new mongoose.Schema({
    email: {
        type: String,
        unique: true,
        index: true,
        lowercase: true,
        trim: true,
        required: true
    },
    password: { type: String, required: true },
    name:     { type: String, default: "" },

    credits:     { type: Number, default: 0 },
    maxSessions: { type: Number, default: 3 },

    isAdmin:  { type: Boolean, default: false, index: true },
    isBanned: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
    lastLogin: Date
}, { timestamps: true });

// ---- SessionSettings (per-session overrides) ----
const SessionSettingsSchema = new mongoose.Schema({
    sessionId:      { type: String, unique: true, index: true, required: true },
    ownerAccountId: { type: String, index: true },
    phoneNumber:    { type: String, index: true },

    // overridable config keys
    prefix:   String,
    botName:  String,
    footer:   String,
    workMode: { type: String, enum: ["public", "private"] },

    autoRead:   Boolean,
    autoReact:  Boolean,
    autoTyping: Boolean,

    antibug:    Boolean,
    antispam:   Boolean,
    antilink:   Boolean,
    antidelete: Boolean,
    anticall:   Boolean,
    antimedia:  { type: String, enum: ["off", "all", "photo", "video", "sticker"] },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ---- MessageLog (per-message audit trail for chat tracking) ----
const MessageLogSchema = new mongoose.Schema({
    accountId:   { type: String, index: true },
    sessionId:   { type: String, index: true, required: true },
    chatJid:     { type: String, index: true, required: true },
    chatName:    String,
    chatType:    { type: String, enum: ["dm", "group"] },
    isGroup:     { type: Boolean, default: false },

    senderJid:   String,
    senderName:  String,
    senderPhone: String,
    fromMe:      { type: Boolean, default: false },

    body:        String,
    messageType: String,
    mediaType:   String,

    timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Compound index for fast per-session per-chat pagination
MessageLogSchema.index({ sessionId: 1, chatJid: 1, timestamp: -1 });

// ---- LiveEvent (real-time monitor feed) ----
const LiveEventSchema = new mongoose.Schema({
    sessionId:   { type: String, index: true, required: true },
    type:        { type: String, default: "message" },
    chatJid:     { type: String, index: true },
    chatName:    String,
    isGroup:     { type: Boolean, default: false },

    senderJid:   String,
    senderName:  String,
    senderPhone: String,
    fromMe:      { type: Boolean, default: false },

    text:        String,
    mediaPath:   String,
    mediaType:   String,
    mediaSize:   Number,
    fileName:    String,

    extra:       Object,
    timestamp:   { type: Date, default: Date.now, index: true }
}, { timestamps: true });

LiveEventSchema.index({ sessionId: 1, timestamp: -1 });

// ---- AutoReply rules ----
const AutoReplySchema = new mongoose.Schema({
    accountId:     { type: String, index: true },
    sessionId:     { type: String, index: true, required: true },
    name:          String,
    matchType:     { type: String, enum: ["contains", "exact", "starts", "regex"], default: "contains" },
    pattern:       { type: String, required: true },
    reply:         { type: String, required: true },
    isGroup:       { type: Boolean, default: false },
    caseSensitive: { type: Boolean, default: false },
    enabled:       { type: Boolean, default: true },
    hits:          { type: Number, default: 0 },
    createdAt:     { type: Date, default: Date.now }
}, { timestamps: true });

// ---- Keyword triggers ----
const KeywordTriggerSchema = new mongoose.Schema({
    accountId: { type: String, index: true },
    sessionId: { type: String, index: true, required: true },
    keyword:   { type: String, required: true },
    reply:     { type: String, required: true },
    mediaUrl:  String,
    mediaType: { type: String, enum: ["", "image", "video"], default: "" },
    enabled:   { type: Boolean, default: true },
    hits:      { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================================
//   STORE APP (for the App Store)
// ============================================================

const StoreAppSchema = new mongoose.Schema({
    name:        { type: String, required: true },
    description: { type: String, required: true },
    category:    { type: String, default: "Tools" },
    price:       { type: Number, default: 0 },
    icon:        { type: String, default: "fa-robot" },
    downloadUrl: { type: String, required: true },
    downloads:   { type: Number, default: 0 },
    createdAt:   { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================================
//   EXPORTS  (mongoose.models.X prevents OverwriteModelError
//   if this file is ever required twice during hot-reload)
// ============================================================

module.exports = {
    // Core (used by your index.js right now)
    User:              mongoose.models.User              || mongoose.model("User", UserSchema),
    ChannelSubscriber: mongoose.models.ChannelSubscriber || mongoose.model("ChannelSubscriber", ChannelSubscriberSchema),
    ChannelPost:       mongoose.models.ChannelPost       || mongoose.model("ChannelPost", ChannelPostSchema),

    // Account system
    Account:           mongoose.models.Account           || mongoose.model("Account", AccountSchema),

    // Per-session settings + chat tracking
    SessionSettings:   mongoose.models.SessionSettings   || mongoose.model("SessionSettings", SessionSettingsSchema),
    MessageLog:        mongoose.models.MessageLog        || mongoose.model("MessageLog", MessageLogSchema),
    LiveEvent:         mongoose.models.LiveEvent         || mongoose.model("LiveEvent", LiveEventSchema),

    // Automation
    AutoReply:         mongoose.models.AutoReply         || mongoose.model("AutoReply", AutoReplySchema),
    KeywordTrigger:    mongoose.models.KeywordTrigger    || mongoose.model("KeywordTrigger", KeywordTriggerSchema),

    // App Store
    StoreApp:          mongoose.models.StoreApp          || mongoose.model("StoreApp", StoreAppSchema)
};