module.exports = {
    name: "demote",
    category: "group",
    description: "Demote an admin to member",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quotedUser;
        
        if (!target) return ctx.reply("❌ Tag or reply to the user you want to demote.");
        
        try {
            await conn.groupParticipantsUpdate(ctx.from, [target], "demote");
            await conn.sendMessage(ctx.from, { text: `✅ Demoted @${target.split('@')[0]} from admin.`, mentions: [target] }, { quoted: msg });
        } catch (e) {
            await ctx.reply("❌ Failed to demote user.");
        }
    }
};