module.exports = {
    name: "unmute",
    category: "group",
    description: "Open group (everyone can send)",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        try {
            await conn.groupSettingUpdate(ctx.from, "not_announcement");
            await ctx.reply("🔓 Group has been unmuted (Everyone can send messages).");
        } catch (e) {
            await ctx.reply("❌ Failed to unmute group.");
        }
    }
};