const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" }, // "admin" or "user"
    linkedNumbers: { type: [String], default: [] } 
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);