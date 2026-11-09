module.exports = {
    name: "antimedia",
    category: "anti",
    description: "Block media (photos, videos, audio, voice notes) from non-admins",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        if (!global.antiMediaGroups) global.antiMediaGroups = new Set();
        
        const action = args[0]?.toLowerCase();
        if (action === "on") {
            global.antiMediaGroups.add(ctx.from);
            return ctx.reply(`✅ ${ctx.fancy("Anti-Media is now ENABLED.")}\n_Photos, videos, audio, and voice notes from non-admins will be deleted._`);
        } 
        if (action === "off") {
            global.antiMediaGroups.delete(ctx.from);
            return ctx.reply(`❌ ${ctx.fancy("Anti-Media is now DISABLED.")}`);
        }
        return ctx.reply(`Usage: \`.antimedia on\` or \`.antimedia off\``);
    }
};