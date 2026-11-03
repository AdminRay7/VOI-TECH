module.exports = {
    name: "subject",
    category: "group",
    description: "Change the group name",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        const newSubject = args.join(" ");
        if (!newSubject) return ctx.reply("❌ Provide a new name for the group.");
        
        try {
            await conn.groupUpdateSubject(ctx.from, newSubject);
            await ctx.reply(`✅ Group name updated to: *${newSubject}*`);
        } catch (e) {
            await ctx.reply("❌ Failed to change group name.");
        }
    }
};