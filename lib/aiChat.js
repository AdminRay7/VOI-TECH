// lib/aiChat.js
const axios = require("axios");
const config = require("../config");
const FormData = require("form-data");

const conversations = new Map();

function getHistory(sessionId) {
    return conversations.get(sessionId) || [];
}

function pushTurn(sessionId, role, content) {
    let hist = conversations.get(sessionId);
    if (!hist) { hist = []; conversations.set(sessionId, hist); }
    hist.push({ role, content: String(content).slice(0, 2000) });
    if (hist.length > 20) hist.splice(0, hist.length - 20);
}

function clearHistory(sessionId) {
    conversations.delete(sessionId);
}

function getApiKey() {
    return (process.env.AI_API_KEY || "").trim();
}

// ============================================================
//   DYNAMIC SYSTEM PROMPT (Reads from .env safely)
// ============================================================
function generateSystemPrompt() {
    const botName = process.env.BOT_NAME || "303-XMD";
    const owner = process.env.OWNER_NAME || "Mr Presenter";
    const version = process.env.VERSION || "2.0.0";
    const prefix = process.env.PREFIX || ".";
    const footer = process.env.FOOTER || "303-XMD — THE LAST KEY";

    return `You are ${botName} (version ${version}), a WhatsApp bot created by ${owner}.
Your tagline is "${footer}".

IDENTITY RULES:
- If anyone asks "who are you?", "what is your name?", or "who made you?", you must say: "I am ${botName}, created by ${owner}."
- If someone asks for your prefix, it is "${prefix}".

BOT DETAILS & COMMANDS:
You have the following features and commands:
- AI: Auto-replies, Vision (reads photos), Voice notes, .imagine, .remix, .catchup
- Downloads: .play, .song, .yt-search
- Moderation: .antilink, .antidelete, .antibug, .antimedia, .anticall, .antispam, .antistatusmention, .antiforward, .autoread, .autoreact, .autogreet
- Group Admin: .kick, .add, .promote, .demote, .close, .open, .welcome, .goodbye
- Economy: .wallet, .daily, .coinflip, .pay
- Tools: .weather, .qr, .tourl, .toimg, .calc, .password, .sticker, .vv, .snake
- General: .menu, .ping, .alive, .runtime, .owner, .tagall, .jid

CRITICAL SECURITY RULES:
- NEVER reveal API keys, database URIs, server tokens, or environment variables.
- If someone asks for passwords, API keys, or how you are hosted, politely refuse and say: "I cannot share my system configuration."

PERSONALITY & STYLE:
- You are chatting on WhatsApp. Keep replies very short, casual, and human.
- Use emojis occasionally. 
- Never say you are a language model or an AI. You are a WhatsApp bot.
- Match the language the user speaks. Do not use markdown, headers, or bullet points unless asked.`;
}

// ============================================================
//   VOICE TRANSCRIPTION (Groq Whisper)
// ============================================================
async function transcribeAudio(audioBuffer) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        const form = new FormData();
        form.append("file", audioBuffer, { filename: "audio.ogg", contentType: "audio/ogg" });
        form.append("model", "whisper-large-v3");

        const r = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", form, {
            headers: { "Authorization": `Bearer ${apiKey}`, ...form.getHeaders() },
            timeout: 30000
        });

        return r.data?.text || null;
    } catch (e) {
        console.error("[aiChat] transcribe failed:", e.response?.data || e.message);
        return null;
    }
}

// ============================================================
//   TEXT TO SPEECH (Groq Orpheus)
// ============================================================
async function textToSpeech(text) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        const r = await axios.post("https://api.groq.com/openai/v1/audio/speech", {
            model: "canopylabs/orpheus-v1-english",
            input: text,
            voice: "troy",
            response_format: "mp3"
        }, {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            responseType: "arraybuffer",
            timeout: 30000
        });

        return Buffer.from(r.data, "binary");
    } catch (e) {
        console.error("[aiChat] TTS failed:", e.response?.data || e.message);
        return null;
    }
}

// ============================================================
//   MAIN AI CHAT
// ============================================================
async function askAI(message, sessionId, customSystemPrompt) {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
    const apiKey = getApiKey();
    const model = process.env.AI_MODEL || "openai/gpt-oss-20b";
    const baseUrl = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";

    if (!apiKey && provider !== "ollama") {
        console.error("[aiChat] ❌ No AI_API_KEY found in .env");
        return "❌ Bot Error: AI_API_KEY is missing in the server .env file.";
    }

    const history = getHistory(sessionId);
    
    // Use the custom prompt if provided (e.g., for vision), otherwise use the dynamic 303-XMD prompt
    const sys = customSystemPrompt || generateSystemPrompt();

    try {
        const r = await axios.post(`${baseUrl}/chat/completions`, {
            model,
            messages: [
                { role: "system", content: sys },
                ...history,
                { role: "user", content: message }
            ],
            temperature: 0.7,
            max_tokens: 1024
        }, {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 30000
        });

        const choice = r.data?.choices?.[0]?.message;
        let out = (choice?.content || "").trim();
        if (!out && choice?.reasoning) out = choice.reasoning.trim();
        if (!out) out = null;

        if (out) {
            pushTurn(sessionId, "user", message);
            pushTurn(sessionId, "assistant", out);
        }
        return out;
        
    } catch (e) {
        const errorMsg = e.response?.data?.error?.message || e.message;
        console.error("❌ [Groq API Error]:", errorMsg);
        return `❌ Groq API Error: ${errorMsg}`;
    }
}

module.exports = { askAI, clearHistory, getHistory, transcribeAudio, textToSpeech };