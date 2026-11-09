module.exports = {
    name: "antisticker",
    category: "anti",
    description: "Block stickers from non-admins",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        if (!global.antiStickerGroups) global.antiStickerGroups = new Set();
        
        const action = args[0]?.toLowerCase();
        if (action === "on") {
            global.antiStickerGroups.add(ctx.from);
            return ctx.reply(`✅ ${ctx.fancy("Anti-Sticker is now ENABLED.")}\n_Stickers from non-admins will be deleted._`);
        } 
        if (action === "off") {
            global.antiStickerGroups.delete(ctx.from);
            return ctx.reply(`❌ ${ctx.fancy("Anti-Sticker is now DISABLED.")}`);
        }
        return ctx.reply(`Usage: \`.antisticker on\` or \`.antisticker off\``);
    }
};