const config = require("../config");

module.exports = {
    name: "goodbye",
    category: "group",
    description: "Toggle goodbye messages on/off",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        if (!global.goodbyeGroups) global.goodbyeGroups = new Set();
        
        const action = args[0]?.toLowerCase();
        if (action === "on") {
            global.goodbyeGroups.add(ctx.from);
            return ctx.reply(`✅ ${ctx.fancy("Goodbye messages are now ENABLED.")}`);
        } 
        if (action === "off") {
            global.goodbyeGroups.delete(ctx.from);
            return ctx.reply(`❌ ${ctx.fancy("Goodbye messages are now DISABLED.")}`);
        }
        
        // Show current status
        const isOn = global.goodbyeGroups.has(ctx.from);
        return ctx.reply(`Usage: \`.goodbye on\` or \`.goodbye off\`\n\nCurrent status: *${isOn ? "ON" : "OFF"}*`);
    }
};