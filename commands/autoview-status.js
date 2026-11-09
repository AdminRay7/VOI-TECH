// commands/autoview-status.js
// Handles automatic viewing of statuses

// Default state (can be changed by typing .autoview on/off)
if (global.autoViewStatus === undefined) global.autoViewStatus = true;

module.exports = {
    name: "autoview",
    category: "settings",
    aliases: ["autostatusview"],
    description: "Toggle auto-view status (on/off)",
    
    // 1. Command to toggle the feature
    async execute(conn, msg, args, ctx) {
        const action = args[0]?.toLowerCase();
        
        if (action !== "on" && action !== "off") {
            return ctx.reply(`👁️ *Auto-View Status* is currently: *${global.autoViewStatus ? "ON" : "OFF"}*\n\nUsage: \`.autoview on\` or \`.autoview off\``);
        }
        
        global.autoViewStatus = (action === "on");
        
        await ctx.reply(`✅ Auto-View Status is now *${global.autoViewStatus ? "ENABLED" : "DISABLED"}*`);
    },

    // 2. The automatic action (triggered by index.js on every status)
    async handleAutoView(conn, msg) {
        if (!global.autoViewStatus) return false;
        
        try {
            // Mark the status as read
            await conn.readMessages([msg.key]);
            return true;
        } catch (error) {
            console.error("Auto-View Error:", error.message);
            return false;
        }
    }
};