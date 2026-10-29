const axios = require("axios");
const config = require("../config");

// Global toggle state (in-memory)
let isAutoReplyEnabled = true; 

module.exports = {
    name: "chat-ai", // Matches the name in presenter.js
    category: "general",
    aliases: ["ai", "gpt"],
    description: "AI Auto-Reply (Use .ai on / .ai off to toggle)",

    // This executes when someone types `.ai`
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

        // If they typed something else (e.g. .ai what is life?), act as a manual prompt
        const prompt = args.join(" ");
        await ctx.reply("🤖 *Thinking...*");
        try {
            const response = await getAIReply(prompt);
            await ctx.reply(response);
        } catch (error) {
            console.error("AI Command Error:", error.message);
            await ctx.reply("❌ AI failed to respond.");
        }
    },

    // This is triggered AUTOMATICALLY by presenter.js for every message
    async handleAutoReply(conn, msg, ctx) {
        // Only run if .env is true AND the toggle is ON
        const isEnabled = config.aiChatEnabled === true || config.aiChatEnabled === "true";
        if (!isEnabled || !isAutoReplyEnabled) return false;

        // Don't reply to commands (starts with .)
        if (ctx.isCmd) return false;

        try {
            let text = ctx.body || "";
            let imageBuffer = null;
            let mimeType = "image/jpeg";

            // Check if the message is an image
            const imageMsg = msg.message?.imageMessage;
            if (imageMsg) {
                const stream = await conn.downloadMediaMessage(msg);
                imageBuffer = stream;
                mimeType = imageMsg.mimetype || "image/jpeg";
                if (imageMsg.caption) text = imageMsg.caption;
            }

            if (!text && !imageBuffer) return false;

            // Show typing indicator
            await conn.sendPresenceUpdate('composing', ctx.from);

            let response;
            if (imageBuffer) {
                response = await getVisionReply(imageBuffer, mimeType, text);
            } else {
                response = await getAIReply(text);
            }
            
            await conn.sendMessage(ctx.from, { text: response }, { quoted: msg });
            return true;

        } catch (error) {
            console.error("AI Auto-Reply Error:", error.message);
            return false;
        }
    }
};

// ============================================================
// GROQ API CALLS (Uses your .env)
// ============================================================
async function getAIReply(prompt) {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    const model = config.aiModel || "llama-3.2-11b-vision-preview"; 
    const systemPrompt = config.aiSystemPrompt;

    const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 150
        },
        {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 15000
        }
    );

    return response.data.choices[0].message.content.trim();
}

async function getVisionReply(imageBuffer, mimeType, prompt) {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    const model = config.aiModel || "llama-3.2-11b-vision-preview"; 
    const systemPrompt = config.aiSystemPrompt;

    const base64Image = imageBuffer.toString("base64");
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt || "What is in this image?" },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ]
                }
            ],
            temperature: 0.7,
            max_tokens: 200
        },
        {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 20000 
        }
    );

    return response.data.choices[0].message.content.trim();
}