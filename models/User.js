// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true, 
        unique: true, 
        sparse: true // 🔥 THIS ALLOWS MULTIPLE WHATSAPP USERS TO SAVE WITHOUT EMAILS
    },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
