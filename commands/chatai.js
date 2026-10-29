const config = require("../config");
const { getAIReply, getVisionReply } = require("../lib/chatai"); // Import the engine

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
            return ctx.reply("✅ AI Auto-Reply is now *ON*. I will reply to all messages and images.");
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

        try {
            let text = ctx.body || "";
            let imageBuffer = null;
            let mimeType = "image/jpeg";

            const imageMsg = msg.message?.imageMessage;
            if (imageMsg) {
                const stream = await conn.downloadMediaMessage(msg);
                imageBuffer = stream;
                mimeType = imageMsg.mimetype || "image/jpeg";
                if (imageMsg.caption) text = imageMsg.caption;
            }

            if (!text && !imageBuffer) return false;

            await conn.sendPresenceUpdate('composing', ctx.from);

            let response;
            try {
                if (imageBuffer) {
                    response = await getVisionReply(imageBuffer, mimeType, text);
                } else {
                    response = await getAIReply(text);
                }
            } catch (apiError) {
                await conn.sendPresenceUpdate('paused', ctx.from);
                await conn.sendMessage(ctx.from, { text: "⚠️ AI Error: " + apiError.message }, { quoted: msg });
                return true;
            }
            
            await conn.sendPresenceUpdate('paused', ctx.from);

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