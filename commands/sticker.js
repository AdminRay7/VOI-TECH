const { downloadMediaMessage } = require("@whiskeysockets/baileys");

module.exports = {
    name: "sticker",
    category: "tools",
    aliases: ["s", "stick"],
    description: "Convert an image to a sticker (Reply to an image)",
    async execute(conn, msg, args, ctx) {
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted || !quoted.imageMessage) {
            return ctx.reply("❌ Please reply to an image with `.sticker`");
        }

        try {
            await ctx.reply("⏳ Creating sticker...");

            const quotedMsg = {
                key: {
                    remoteJid: ctx.from,
                    id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                    participant: msg.message.extendedTextMessage.contextInfo.participant || ctx.from
                },
                message: quoted
            };

            const buffer = await downloadMediaMessage(quotedMsg, "buffer", {}, { logger: console, reuploadRequest: conn.updateMediaMessage });

            await conn.sendMessage(ctx.from, { sticker: buffer }, { quoted: msg });
        } catch (error) {
            console.error("Sticker error:", error.message);
            await ctx.reply("❌ Failed to create sticker.");
        }
    }
};