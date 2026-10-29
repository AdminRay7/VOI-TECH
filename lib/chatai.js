const axios = require("axios");
const config = require("../config");

async function getAIReply(prompt) {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    const model = "openai/gpt-oss-20b"; 
    const systemPrompt = config.aiSystemPrompt;

    if (!apiKey) throw new Error("AI_API_KEY is missing in .env");

    try {
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
        return response.data.choices[0].message.content;
    } catch (error) {
        if (error.response?.data?.error) {
            throw new Error(error.response.data.error.message);
        }
        throw new Error(error.message);
    }
}

async function getVisionReply(imageBuffer, mimeType, prompt) {
    const apiKey = config.aiApiKey;
    const baseUrl = config.aiBaseUrl || "https://api.groq.com/openai/v1";
    const model = "qwen/qwen3.8-27b"; 
    const systemPrompt = config.aiSystemPrompt;

    if (!apiKey) throw new Error("AI_API_KEY is missing in .env");

    const base64Image = imageBuffer.toString("base64");
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    try {
        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt || "Describe this image" },
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
        return response.data.choices[0].message.content;
    } catch (error) {
        if (error.response?.data?.error) {
            throw new Error(error.response.data.error.message);
        }
        throw new Error(error.message);
    }
}

module.exports = { getAIReply, getVisionReply };