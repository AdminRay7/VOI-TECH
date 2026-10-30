const { downloadMediaMessage } = require("@whiskeysockets/baileys");

module.exports = {
    name: "vv",
    category: "general",
    aliases: ["viewonce", "reveal"],
    description: "Retrieve a View Once image/video",
    async execute(conn, msg, args, ctx) {
        try {
            // Check if the user is replying to a message
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return ctx.reply("❌ Please reply to a View Once image or video with `.vv`");
            }

            // Unwrap the quoted message to find the media
            let mediaMessage = quoted;
            if (mediaMessage.viewOnceMessageV2) mediaMessage = mediaMessage.viewOnceMessageV2.message;
            if (mediaMessage.viewOnceMessage) mediaMessage = mediaMessage.viewOnceMessage.message;
            if (mediaMessage.ephemeralMessage) mediaMessage = mediaMessage.ephemeralMessage.message;

            let type = null;
            let media = null;

            // Check for Image or Video
            if (mediaMessage.imageMessage) {
                type = "image";
                media = mediaMessage.imageMessage;
            } else if (mediaMessage.videoMessage) {
                type = "video";
                media = mediaMessage.videoMessage;
            }

            if (!type || !media) {
                return ctx.reply("❌ The replied message is not a View Once image or video.");
            }

            await ctx.reply("⏳ Downloading media...");

            // Construct the message object for download
            const quotedMsg = {
                key: {
                    remoteJid: ctx.from,
                    id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                    participant: msg.message.extendedTextMessage.contextInfo.participant || ctx.from
                },
                message: quoted
            };

            // Download the media buffer
            const buffer = await downloadMediaMessage(
                quotedMsg,
                "buffer",
                {},
                { logger: console, reuploadRequest: conn.updateMediaMessage }
            );

            if (!buffer) {
                return ctx.reply("❌ Failed to download the media.");
            }

            // Send the media back
            const caption = media.caption ? `📝 *Caption:* ${media.caption}` : "";
            
            if (type === "image") {
                await conn.sendMessage(ctx.from, { 
                    image: buffer, 
                    caption: caption || "✅ *View Once Image Revealed*" 
                }, { quoted: msg });
            } else if (type === "video") {
                await conn.sendMessage(ctx.from, { 
                    video: buffer, 
                    caption: caption || "✅ *View Once Video Revealed*" 
                }, { quoted: msg });
            }

        } catch (error) {
            console.error("VV Command Error:", error);
            await ctx.reply("❌ An error occurred while retrieving the media.");
        }
    }
};
