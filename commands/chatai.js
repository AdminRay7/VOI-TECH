const config = require("../config");
const { getAIReply, getVisionReply } = require("../lib/chatai"); 

let isAutoReplyEnabled = true; 

module.exports = {
    name: "chat-ai",
    category: "general",
    aliases: ["ai", "gpt"],
    description: "AI Auto-Reply (Use .ai on / .ai off to toggle)",

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply(`AI Auto-Reply is currently *${isAutoReplyEnabled ? "ON" : "OFF"}*.\nUse \`.ai on\` or \`.ai off\` to change it.`);
        }

        const action = args[0].toLowerCase();
        if (action === "on") {
            isAutoReplyEnabled = true;
            return ctx.reply("✅ AI Auto-Reply is now *ON*.");
        } 
        if (action === "off") {
            isAutoReplyEnabled = false;
            return ctx.reply("❌ AI Auto-Reply is now *OFF*.");
        }

        const prompt = args.join(" ");
        await ctx.reply("🤖 *Thinking...*");
        try {
            const response = await getAIReply(prompt);
            await ctx.reply(response);
        } catch (error) {
            console.error("AI Command Error:", error.message);
            await ctx.reply("❌ AI Error: " + error.message);
        }
    },

    async handleAutoReply(conn, msg, ctx) {
        const isEnabled = config.aiChatEnabled === true || config.aiChatEnabled === "true";
        if (!isEnabled || !isAutoReplyEnabled) return false;
        if (ctx.isCmd) return false;

        // Block Owner & Bot
        if (msg.key.fromMe) return false;
        const botNumber = conn.user.id.split(':')[0];
        const senderNumber = ctx.sender.split('@')[0].split(':')[0];
        if (senderNumber === botNumber) return false;
        if (config.ownerNumber) {
            const owners = String(config.ownerNumber).split(",").map(n => n.replace(/\D/g, ""));
            if (owners.includes(senderNumber)) return false;
        }

        try {
            let text = ctx.body || "";
            let imageBuffer = null;
            let mimeType = "image/jpeg";

            // ============================================================
            // 🖼️ UNWRAP THE MESSAGE TO FIND HIDDEN IMAGES
            // ============================================================
            let realMessage = msg.message;
            
            // Unwrap view-once or ephemeral messages
            if (realMessage?.viewOnceMessageV2) realMessage = realMessage.viewOnceMessageV2.message;
            if (realMessage?.viewOnceMessage) realMessage = realMessage.viewOnceMessage.message;
            if (realMessage?.ephemeralMessage) realMessage = realMessage.ephemeralMessage.message;
            if (realMessage?.documentWithCaptionMessage) realMessage = realMessage.documentWithCaptionMessage.message;

            const imageMsg = realMessage?.imageMessage;
            
            if (imageMsg) {
                // Download the actual image buffer
                const stream = await conn.downloadMediaMessage(msg);
                imageBuffer = stream;
                mimeType = imageMsg.mimetype || "image/jpeg";
                
                // If there is a caption (like "read these photo"), use it as the prompt
                if (imageMsg.caption) {
                    text = imageMsg.caption;
                } else {
                    text = "Describe this image in detail.";
                }
            }

            if (!text && !imageBuffer) return false;

            // ============================================================
            // ⏱️ 10 SECOND DELAY WITH TYPING INDICATOR
            // ============================================================
            await conn.sendPresenceUpdate('composing', ctx.from);
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay
            await conn.sendPresenceUpdate('paused', ctx.from);

            let response;
            try {
                if (imageBuffer) {
                    // Use Vision model
                    response = await getVisionReply(imageBuffer, mimeType, text);
                } else {
                    // Use Text model
                    response = await getAIReply(text);
                }
            } catch (apiError) {
                await conn.sendMessage(ctx.from, { text: "⚠️ AI Error: " + apiError.message }, { quoted: msg });
                return true;
            }

            if (response && response.trim().length > 0) {
                await conn.sendMessage(ctx.from, { text: response.trim() }, { quoted: msg });
            }
            
            return true;

        } catch (error) {
            console.error("AI Auto-Reply Fatal Error:", error.message);
            try { await conn.sendPresenceUpdate('paused', ctx.from); } catch(e){}
            return false;
        }
    }
};