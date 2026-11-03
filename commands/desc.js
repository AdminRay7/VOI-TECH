module.exports = {
    name: "desc",
    category: "group",
    description: "Change the group description",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        const newDesc = args.join(" ");
        if (!newDesc) return ctx.reply("❌ Provide a new description.");
        
        try {
            await conn.groupUpdateDescription(ctx.from, newDesc);
            await ctx.reply(`✅ Group description updated successfully.`);
        } catch (e) {
            await ctx.reply("❌ Failed to change description.");
        }
    }
};