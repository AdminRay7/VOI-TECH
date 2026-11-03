module.exports = {
    name: "revoke",
    category: "group",
    description: "Reset the group invite link",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        try {
            await conn.groupRevokeInvite(ctx.from);
            await ctx.reply("✅ Group invite link has been reset successfully.");
        } catch (e) {
            await ctx.reply("❌ Failed to reset link.");
        }
    }
};