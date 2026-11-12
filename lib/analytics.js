// lib/analytics.js
// Records command usage, errors, and message volume per hour.

const mongoose = require("mongoose");

const CommandUsageSchema = new mongoose.Schema({
    sessionId: String,
    accountId: String,
    command:   { type: String, index: true },
    sender:    String,
    isGroup:   Boolean,
    success:   Boolean,
    errorMsg:  String,
    durationMs:Number,
    timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

CommandUsageSchema.index({ command: 1, timestamp: -1 });

const CommandUsage = mongoose.models.CommandUsage ||
    mongoose.model("CommandUsage", CommandUsageSchema);

async function recordCommand({ sessionId, accountId, command, sender, isGroup, success, errorMsg, durationMs }) {
    try {
        await CommandUsage.create({
            sessionId, accountId, command, sender, isGroup,
            success: success !== false,
            errorMsg: errorMsg ? String(errorMsg).slice(0, 500) : null,
            durationMs: durationMs || null,
            timestamp: new Date()
        });
    } catch (e) {
        console.error("analytics.recordCommand:", e.message);
    }
}

async function topCommands(days = 7, limit = 20) {
    const since = new Date(Date.now() - days * 86400000);
    return CommandUsage.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: {
            _id: "$command",
            count: { $sum: 1 },
            errors: { $sum: { $cond: ["$success", 0, 1] } },
            avgMs: { $avg: "$durationMs" }
        }},
        { $sort: { count: -1 } },
        { $limit: limit }
    ]);
}

async function hourlyVolume(hours = 24) {
    const since = new Date(Date.now() - hours * 3600000);
    return CommandUsage.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d %H:00", date: "$timestamp" } },
            count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
    ]);
}

async function errorsRecent(limit = 50) {
    return CommandUsage.find({ success: false })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
}

module.exports = {
    recordCommand,
    topCommands,
    hourlyVolume,
    errorsRecent,
    CommandUsage
};
