const config = require("../config");

module.exports = {
    name: "welcome",
    category: "group",
    description: "Toggle welcome messages on/off",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        if (!global.welcomeGroups) global.welcomeGroups = new Set();
        
        const action = args[0]?.toLowerCase();
        if (action === "on") {
            global.welcomeGroups.add(ctx.from);
            return ctx.reply(`✅ ${ctx.fancy("Welcome messages are now ENABLED.")}`);
        } 
        if (action === "off") {
            global.welcomeGroups.delete(ctx.from);
            return ctx.reply(`❌ ${ctx.fancy("Welcome messages are now DISABLED.")}`);
        }
        
        // Show current status
        const isOn = global.welcomeGroups.has(ctx.from);
        return ctx.reply(`Usage: \`.welcome on\` or \`.welcome off\`\n\nCurrent status: *${isOn ? "ON" : "OFF"}*`);
    }
};