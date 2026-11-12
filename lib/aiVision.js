// lib/aiVision.js
// Vision AI with per-session image memory.
// Photos are described naturally and follow-ups remember the image.

const axios = require("axios");

// ============================================================
//   SESSION IMAGE MEMORY
// ============================================================
const imageMemory = new Map();
const MEMORY_TTL = 15 * 60 * 1000;

function setSessionImage(chatJid, buffer, mime) {
    imageMemory.set(chatJid, {
        buffer,
        mime: mime || "image/jpeg",
        ts: Date.now()
    });
}

function getSessionImage(chatJid) {
    const e = imageMemory.get(chatJid);
    if (!e) return null;
    if (Date.now() - e.ts > MEMORY_TTL) {
        imageMemory.delete(chatJid);
        return null;
    }
    return e;
}

function clearSessionImage(chatJid) {
    imageMemory.delete(chatJid);
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of imageMemory) {
        if (now - v.ts > MEMORY_TTL) imageMemory.delete(k);
    }
}, 5 * 60 * 1000).unref();

// ============================================================
//   VISION AI (Groq Qwen 3.8)
// ============================================================
async function visionAI(imageBuffer, mimeType, prompt, systemPrompt) {
    const apiKey = (process.env.AI_API_KEY || "").trim()
        ||

    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64}`;

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({
        role: "user",
        content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } }
        ]
    });

    const r = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "qwen/qwen3.8-27b",
            messages,
            temperature: 0.7,
            max_completion_tokens: 500
        },
        {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 60000
        }
    );

    const msg = r.data?.choices?.[0]?.message;
    let out = (msg?.content || "").trim();
    if (!out && msg?.reasoning) out = msg.reasoning.trim();
    return out || null;
}

// ============================================================
//   DESCRIBE — conversational, like a friend reacting
// ============================================================
async function describePhoto(imageBuffer, mimeType, userCaption, systemPrompt) {
    const prompt = userCaption
        ? `The user sent this photo with the caption: "${userCaption}". Reply naturally as a friend would — react to the photo AND respond to what they said.`
        : `The user sent this photo on WhatsApp. React to it like a friend would — describe what you see briefly and naturally, in 1-2 short sentences, then say something conversational. Match their language. Don't list options, don't use bullet points, don't use markdown.`;

    return await visionAI(imageBuffer, mimeType, prompt, systemPrompt);
}

// ============================================================
//   FOLLOW-UP — user replied after sending a photo
// ============================================================
async function answerAboutPhoto(imageBuffer, mimeType, userMessage, systemPrompt) {
    const prompt = `You are chatting on WhatsApp. The user earlier sent you this photo. Now they say: "${userMessage}". Reply naturally based on the image. Keep it short and casual — like texting a friend. Match their language. No markdown, no bullet points.`;

    return await visionAI(imageBuffer, mimeType, prompt, systemPrompt);
}

// ============================================================
//   GENERATE (Pollinations)
// ============================================================
async function generateImage(prompt) {
    if (!prompt || !prompt.trim()) throw new Error("Empty prompt");
    const encoded = encodeURIComponent(prompt.trim());
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux`;
    const r = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxContentLength: 8 * 1024 * 1024,
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    return { buffer: Buffer.from(r.data), url };
}

// ============================================================
//   REMOVE BG
// ============================================================
async function removeBg(imageBuffer) {
    const key = process.env.REMOVEBG_API_KEY;
    if (!key) throw new Error("REMOVEBG_API_KEY not set");
    const FormData = require("form-data");
    const form = new FormData();
    form.append("image_file", imageBuffer, { filename: "image.jpg" });
    form.append("size", "auto");
    const r = await axios.post("https://api.remove.bg/v1.0/removebg", form, {
        headers: { ...form.getHeaders(), "X-Api-Key": key },
        responseType: "arraybuffer",
        timeout: 45000,
        maxContentLength: 10 * 1024 * 1024
    });
    return Buffer.from(r.data);
}

module.exports = {
    visionAI,
    describePhoto,
    answerAboutPhoto,
    generateImage,
    removeBg,
    setSessionImage,
    getSessionImage,
    clearSessionImage
};
