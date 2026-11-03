module.exports = {
    name: "link",
    category: "group",
    description: "Get the group invite link",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        try {
            const code = await conn.groupInviteCode(ctx.from);
            await ctx.reply(`🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}`);
        } catch (e) {
            await ctx.reply("❌ Failed to get link. Make sure I am an admin.");
        }
    }
};