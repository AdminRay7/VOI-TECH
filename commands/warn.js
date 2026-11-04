if (count >= 3) {
    global.warns.delete(key);
    try {
        await conn.groupParticipantsUpdate(ctx.from, [target], "remove");
        // FANCY FONT HERE
        await conn.sendMessage(ctx.from, { text: `🚨 @${target.split('@')[0]} ${ctx.fancy("has been kicked after 3 warnings!")}`, mentions: [target] });
    } catch (e) {
        await ctx.reply("❌ Failed to kick user. Make sure I am admin.");
    }
} else {
    // FANCY FONT HERE
    await conn.sendMessage(ctx.from, { 
        text: `⚠️ *${ctx.fancy(`WARNING ${count}/3`)}*\n@${target.split('@')[0]}, ${ctx.fancy("please follow the group rules.")}`, 
        mentions: [target] 
    }, { quoted: msg });
}