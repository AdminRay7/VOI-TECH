module.exports = {
    name: "add",
    category: "group",
    description: "Add a member to the group",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        
        const groupMetadata = await conn.groupMetadata(ctx.from);
        const userParticipant = groupMetadata.participants.find(p => p.id === ctx.sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';
        if (!isAdmin && !ctx.isOwner) return ctx.reply("❌ You must be an admin.");

        const num = args[0]?.replace(/\D/g, "");
        if (!num) return ctx.reply("❌ Provide a phone number. Example: `.add 254712345678`");
        
        try {
            const res = await conn.groupParticipantsUpdate(ctx.from, [`${num}@s.whatsapp.net`], "add");
            if (res[0].status === "403") return ctx.reply("❌ User has privacy settings preventing them from being added.");
            if (res[0].status === "408") return ctx.reply("❌ User recently left the group.");
            if (res[0].status === "409") return ctx.reply("❌ User is already in the group.");
            await conn.sendMessage(ctx.from, { text: `✅ Added @${num}`, mentions: [`${num}@s.whatsapp.net`] }, { quoted: msg });
        } catch (e) {
            await ctx.reply("❌ Failed to add user.");
        }
    }
};