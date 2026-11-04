module.exports = {
    name: "antilink",
    category: "anti",
    description: "Toggle anti-link protection (on/off)",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");
        
        if (!global.antiLinkGroups) global.antiLinkGroups = new Set();
        
        const action = args[0]?.toLowerCase();
        if (action === "on") {
            global.antiLinkGroups.add(ctx.from);
            // HERE IS THE FANCY FONT
            return ctx.reply(`✅ ${ctx.fancy("Anti-Link is now ENABLED for this group.")}`);
        } 
        if (action === "off") {
            global.antiLinkGroups.delete(ctx.from);
            // HERE IS THE FANCY FONT
            return ctx.reply(`❌ ${ctx.fancy("Anti-Link is now DISABLED for this group.")}`);
        }
        return ctx.reply(`Usage: \`.antilink on\` or \`.antilink off\``);
    }
};