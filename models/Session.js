const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    sessionId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
