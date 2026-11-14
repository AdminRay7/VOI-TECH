'use strict';

module.exports = {
    name: "newsletter",
    aliases: ["chjid", "channelid", "jid"],
    description: "Generate Newsletter JID (Numbers Only) from a Channel link",
    category: "tools",
    
    execute: async (conn, msg, args, { from, fancy }) => {
        const link = args[0];

        if (!link) {
            return conn.sendMessage(from, {
                text: fancy("🔑 *ᴜꜱᴀɢᴇ:* .newsletter <channel_link>\n\n*ᴇxᴀᴍᴘʟᴇ:* .newsletter https://whatsapp.com/channel/0029VbDU...")
            }, { quoted: msg });
        }

        if (!link.includes("whatsapp.com/channel/")) {
            return conn.sendMessage(from, {
                text: fancy("❌ ɪɴᴠᴀʟɪᴅ ʟɪɴᴋ. ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴡʜᴀᴛꜱᴀᴘᴘ ᴄʜᴀɴɴᴇʟ ʟɪɴᴋ.")
            }, { quoted: msg });
        }

        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: msg.key } });

            // 1. Try to get the official metadata from Baileys
            let numericId = null;
            let channelName = "Unknown Channel";

            if (typeof conn.newsletterFromUrl === 'function') {
                try {
                    const metadata = await conn.newsletterFromUrl(link);
                    if (metadata && metadata.id) {
                        // metadata.id is usually "1234567890@newsletter"
                        numericId = metadata.id.split('@')[0];
                        channelName = metadata.name || "Unknown";
                    }
                } catch (e) {
                    console.log("[newsletter] API fetch failed, using fallback...");
                }
            }

            // 2. Fallback: Extract from link manually if API fails
            if (!numericId) {
                const parts = link.split('/channel/');
                if (parts.length > 1) {
                    // Remove any trailing stuff like ?si=...
                    numericId = parts[1].split('?')[0].split('/')[0];
                }
            }

            if (!numericId) {
                throw new Error("Could not extract ID from link.");
            }

            // Format output
            const responseText = 
                `🔑 *303-XMD ɴᴇᴡꜱʟᴇᴛᴛᴇʀ ɪᴅ*\n\n` +
                `📛 *ɴᴀᴍᴇ:* ${channelName}\n` +
                `🆔 *ɴᴜᴍᴇʀɪᴄ ᴊɪᴅ:* ${numericId}\n` +
                `🔗 *ꜰᴜʟʟ ᴊɪᴅ:* ${numericId}@newsletter\n\n` +
                `_Copy the Full JID above to use in your .env file._`;

            await conn.sendMessage(from, { 
                text: fancy(responseText) 
            }, { quoted: msg });

            await conn.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error("[newsletter] Error:", e.message);
            await conn.sendMessage(from, { react: { text: '❌', key: msg.key } });
            
            await conn.sendMessage(from, {
                text: fancy("❌ ꜰᴀɪʟᴇᴅ ᴛᴏ ꜰᴇᴛᴄʜ ɴᴇᴡꜱʟᴇᴛᴛᴇʀ ɪᴅ. ᴍᴀᴋᴇ ꜱᴜʀᴇ ᴛʜᴇ ʟɪɴᴋ ɪꜱ ᴠᴀʟɪᴅ.")
            }, { quoted: msg });
        }
    }
};