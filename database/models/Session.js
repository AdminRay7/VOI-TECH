const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, index: true, unique: true },
    phone:     String,
    jid:       String,
    connected: { type: Boolean, default: false },
    lastSeen:  Date,
    meta:      { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.models.Session || mongoose.model("Session", sessionSchema);