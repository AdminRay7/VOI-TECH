const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    commands: {
        autoread: { type: Boolean, default: true },
        autoview: { type: Boolean, default: true },
        autoreact: { type: Boolean, default: false },
        antilink: { type: Boolean, default: false },
        antimedia: { type: Boolean, default: false },
        antisticker: { type: Boolean, default: false },
        antidelete: { type: Boolean, default: true }
    }
});

module.exports = mongoose.models.Settings || mongoose.model("Settings", settingsSchema);