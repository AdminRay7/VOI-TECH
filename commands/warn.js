module.exports = {
    name: "warn",
    category: "anti",
    description: "Warn a user (3 warnings = kick)",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin) return ctx.reply("❌ You must be an admin.");

        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quotedUser;
        
        if (!target) return ctx.reply("❌ Tag or reply to the user you want to warn.");

        if (!global.warns) global.warns = new Map();
        const key = `${ctx.from}_${target}`;
        
        let count = (global.warns.get(key) || 0) + 1;
        global.warns.set(key, count);

        if (count >= 3) {
            global.warns.delete(key);
            try {
                await conn.groupParticipantsUpdate(ctx.from, [target], "remove");
                await conn.sendMessage(ctx.from, { text: `🚨 @${target.split('@')[0]} has been kicked after 3 warnings!`, mentions: [target] });
            } catch (e) {
                await ctx.reply("❌ Failed to kick user. Make sure I am admin.");
            }
        } else {
            await conn.sendMessage(ctx.from, { 
                text: `⚠️ *WARNING ${count}/3*\n@${target.split('@')[0]}, please follow the group rules.`, 
                mentions: [target] 
            }, { quoted: msg });
        }
    }
};