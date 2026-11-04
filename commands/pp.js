module.exports = {
    name: "pp",
    category: "general",
    aliases: ["profile", "dp", "pic"],
    description: "Fetch a user's profile picture and details",
    async execute(conn, msg, args, ctx) {
        try {
            // 1. Detect the target user
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
            
            // If user replied or tagged someone, use them. Otherwise, use the sender.
            const target = mentioned[0] || quotedUser || ctx.sender;
            
            await ctx.reply("📸 Fetching profile picture...");

            // 2. Fetch the profile picture URL
            let profilePicUrl;
            try {
                profilePicUrl = await conn.profilePictureUrl(target, 'image');
            } catch (e) {
                // If the user has no profile pic or privacy settings block it
                return ctx.reply("❌ Could not fetch the profile picture. The user may have no picture or hidden it with privacy settings.");
            }

            // 3. Format the details
            const targetNumber = target.split('@')[0];
            // Try to get the name from the message if they are the sender, otherwise just use the number
            const pushName = target === ctx.sender ? ctx.pushname : "User";

            const caption = 
`╭─── • 👤 • ───╮
   *USER PROFILE*
╰─── • 👤 • ───╯

• *Name:* ${ctx.fancy(pushName)}
• *Number:* ${targetNumber}
• *Tag:* @${targetNumber}

_Powered by ${ctx.config.botName}_`;

            // 4. Send the Image with the Caption
            await conn.sendMessage(ctx.from, { 
                image: { url: profilePicUrl }, 
                caption: caption,
                mentions: [target]
            }, { quoted: msg });

        } catch (error) {
            console.error("PP Command Error:", error);
            await ctx.reply("❌ An error occurred while fetching the profile.");
        }
    }
};