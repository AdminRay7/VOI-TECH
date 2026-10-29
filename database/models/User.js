const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    jid:      { type: String, index: true, unique: true },
    pushName: String,
    isOwner:  { type: Boolean, default: false },
    banned:   { type: Boolean, default: false },
    meta:     { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);