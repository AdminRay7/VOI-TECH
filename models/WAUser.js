const mongoose = require('mongoose');

const waUserSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    name: { type: String },
    sessionId: { type: String, index: true },
    messageCount: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now }
});

module.exports = mongoose.models.WAUser || mongoose.model('WAUser', waUserSchema);
