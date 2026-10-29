const axios = require("axios");
const config = require("../config");

// Store active chats so it doesn't reply to itself or spam
const activeChats = new Set();

module.exports = {
    name: "chat-ai",
    category: "general",
    aliases: ["ai", "gpt"],
    description: "Chat with AI (Auto-replies to everything including photos)",

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply("Please provide a prompt. Example: `.ai what is life?`");
        }
        
        const prompt = args.join(" ");
        await ctx.reply("🤖 *Thinking...*");
        
        try {
            const response = await getAIReply(prompt);
            await ctx.reply(response);
        } catch (error) {
            console.error("AI Command Error:", error.message);
            await ctx.reply("❌ AI failed to respond. Check Heroku logs.");
        }
    },

    // This handles the AUTO-REPLY logic
    async handleAutoReply(conn, msg, ctx) {
        const isEnabled = config.aiChatEnabled === true || config.aiChatEnabled === "true";
        if (!isEnabled) return false;

        // Don't reply to commands
        if (ctx.isCmd) return false;

        // Prevent double-replies
        const msgId = msg.key.id;
        if (activeChats.has(msgId)) return false;
        activeChats.add(msgId);
        setTimeout(() => activeChats.delete(msgId), 5000);

        try {
            // Get the actual message content
            let text = ctx.body || "";
            let imageBuffer = null;
            let mimeType = "image/jpeg";

            // Check if the message is an image
            const imageMsg = msg.message?.imageMessage;
            if (imageMsg) {
                // Download the image
                const stream = await conn.downloadMediaMessage(msg);
                imageBuffer = stream;
                mimeType = imageMsg.mimetype || "image/jpeg";
                
                // Use the caption as the text prompt, if available
                if (imageMsg.caption) text = imageMsg.caption;
            }

            // If there is no text and no image, ignore
            if (!text && !imageBuffer) return false;

            // Show typing indicator
            await conn.sendPresenceUpdate('composing', ctx.from);

            let response;
            if (imageBuffer) {
                // Use Vision model for images
                response = await getVisionReply(imageBuffer, mimeType, text, ctx.pushname);
            } else {
                // Use Text model for text
                response = await getAIReply(text, ctx.pushname);
            }
            
            // Send response
            await conn.sendMessage(ctx.from, { text: response }, { quoted: msg });
            return true;

        } catch (error) {
            console.error("AI Auto-Reply Error:", error.message);
            return false;
        }
    }
};

// ============================================================
// TEXT API CALL (Groq)
// ============================================================
async function getAIReply(prompt, username = "User") {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    // Defaulting to a fast Groq model
    const model = config.aiModel || "llama3-8b-8192"; 

    if (!apiKey) throw new Error("AI_API_KEY is missing in .env");

    const systemPrompt = `You are a normal person chatting in a WhatsApp group. Keep replies very short, casual, human. Use emojis occasionally. Never mention you are an AI or bot. Reply in the same language the group uses. Don't use markdown, headers, or bullet points. The user's name is ${username}.`;

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

// ============================================================
// VISION API CALL (Groq)
// ============================================================
async function getVisionReply(imageBuffer, mimeType, prompt, username = "User") {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    // Groq's Vision model
    const model = "llama-3.2-11b-vision-preview"; 

    if (!apiKey) throw new Error("AI_API_KEY is missing in .env");

    // Convert image buffer to base64
    const base64Image = imageBuffer.toString("base64");
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    const systemPrompt = `You are a normal person chatting in a WhatsApp group. Look at the image the user sent and reply naturally and casually. Keep it very short. Do not mention you are an AI.`;

    // Build messages array
    const messages = [
        { role: "system", content: systemPrompt }
    ];

    // Add user message with image
    messages.push({
        role: "user",
        content: [
            { type: "text", text: prompt || "What is in this image?" },
            { type: "image_url", image_url: { url: imageUrl } }
        ]
    });

    const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 200
        },
        {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 20000 // Vision takes a bit longer
        }
    );

    return response.data.choices[0].message.content.trim();
}