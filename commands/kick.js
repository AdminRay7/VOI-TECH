module.exports = {
    name: "kick",
    category: "group",
    description: "Kick a member from the group",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quotedUser;
        
        if (!target) return ctx.reply("❌ Tag or reply to the user you want to kick.");
        
        try {
            await conn.groupParticipantsUpdate(ctx.from, [target], "remove");
            await conn.sendMessage(ctx.from, { text: `✅ Kicked @${target.split('@')[0]}`, mentions: [target] }, { quoted: msg });
        } catch (e) {
            await ctx.reply("❌ Failed to kick user. Make sure I am an admin.");
        }
    }
};