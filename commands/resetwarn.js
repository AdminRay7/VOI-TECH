module.exports = {
    name: "resetwarn",
    category: "anti",
    description: "Reset warnings for a user",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quotedUser;
        
        if (!target) return ctx.reply("❌ Tag or reply to the user.");

        if (global.warns) global.warns.delete(`${ctx.from}_${target}`);
        await conn.sendMessage(ctx.from, { text: `✅ Warnings reset for @${target.split('@')[0]}`, mentions: [target] }, { quoted: msg });
    }
};