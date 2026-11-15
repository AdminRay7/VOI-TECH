// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: [true, "Email is required to register"], // 🔥 FORCES WEB USERS TO PROVIDE EMAIL
        unique: true, 
        sparse: true // 🔥 ALLOWS BOT USERS TO SAVE WITHOUT EMAIL
    },
    password: { 
        type: String, 
        required: [true, "Password is required to register"] // 🔥 FORCES WEB USERS TO PROVIDE PASSWORD
    },
    role: { type: String, default: 'user' }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
