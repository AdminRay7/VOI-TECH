require("dotenv").config();

function bool(v, d) {
    if (v === undefined || v === null || v === "") return d;
    const s = String(v).toLowerCase().trim();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
    return d;
}
function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}
function str(v, d) {
    if (v === undefined || v === null || v === "") return d;
    return String(v);
}
function list(v, d = []) {
    if (!v) return d;
    return String(v).split(",").map(s => s.trim()).filter(Boolean);
}
function required(name, value) {
    if (value === undefined || value === null || value === "") {
        console.warn(`⚠️ Missing required env: ${name}`);
        return "";
    }
    return value;
}

module.exports = {
    botName:     str(process.env.BOT_NAME,     "303-XMD"),
    ownerNumber: required("OWNER_NUMBER", str(process.env.OWNER_NUMBER, "")),
    ownerName:   str(process.env.OWNER_NAME,   "mr presenter"),

    adminEmail:  str(process.env.ADMIN_EMAIL,  ""),
    adminEmails: list(process.env.ADMIN_EMAIL, []).map(e => e.toLowerCase()),

    aiChatEnabled:  bool(process.env.AI_CHAT_ENABLED, false),
    aiChatGroups:   bool(process.env.AI_CHAT_GROUPS, true),
    aiProvider:     str(process.env.AI_PROVIDER, "openai"),
    aiModel:        str(process.env.AI_MODEL, "openai/gpt-oss-20b"),
    aiBaseUrl:      str(process.env.AI_BASE_URL, "https://api.groq.com/openai/v1"),
    aiApiKey:       str(process.env.AI_API_KEY, ""),
    aiSystemPrompt: str(process.env.AI_SYSTEM_PROMPT,
        "You are a normal person chatting in a WhatsApp group. Keep replies very short, casual, human. Use emojis occasionally. Never mention you are an AI or bot. Reply in the same language the group uses. Don't use markdown, headers, or bullet points."),

    prefix:      str(process.env.PREFIX,       "."),
    footer:      str(process.env.FOOTER,       "303-XMD — THE LAST KEY"),
    version:     str(process.env.VERSION,      "2.0.0"),
    description: "The Last Key",

    sessionDir:  str(process.env.SESSION_DIR,  "./session"),
    phoneNumber: str(process.env.PHONE,        ""),

    apiKey:       str(process.env.API_KEY, ""),
    hfToken:      str(process.env.HF_TOKEN, ""),
    modelslabKey: str(process.env.MODELSLAB_KEY, ""),

    port: num(process.env.PORT, 3000),

    mongodb: str(process.env.MONGODB_URI, ""),

    newsletterJid: str(process.env.NEWSLETTER_JID, ""),
    channelLink:   str(process.env.CHANNEL_LINK, ""),

    autoReactChannel:     bool(process.env.AUTO_REACT_CHANNEL,     true),
    autoSubscribeChannel: bool(process.env.AUTO_SUBSCRIBE_CHANNEL, true),
    logChannelPosts:      bool(process.env.LOG_CHANNEL_POSTS,      true),
    channelEmojis:        list(process.env.CHANNEL_EMOJIS, ["🔑","🔥","⭐","✨","💯","🚀","👑"]),
    channelKeywordReactions: {
        crypto:   "🪙",
        giveaway: "🎁",
        update:   "📢",
        new:      "🆕",
        sale:     "💸",
        live:     "🔴"
    },
    forwardChannelTo: list(process.env.FORWARD_CHANNEL_TO, []),
    crossPostWebhook: str(process.env.CROSS_POST_WEBHOOK, ""),

    autoRead:    bool(process.env.AUTO_READ,   true),
    autoReact:   bool(process.env.AUTO_REACT,  true),
    autoSave:    bool(process.env.AUTO_SAVE,   true),
    autoTyping:  bool(process.env.AUTO_TYPING, true),
    anticall:    bool(process.env.ANTICALL,    true),
    antibug:     bool(process.env.ANTIBUG,     true),
    antispam:    bool(process.env.ANTISPAM,    true),
    antilink:    bool(process.env.ANTILINK,    false),
    antidelete:  bool(process.env.ANTIDELETE,  true),
    antimedia:   str(process.env.ANTIMEDIA,    "off"),
    workMode:    str(process.env.WORK_MODE,    "public"),

    autoStatus: {
        view:  bool(process.env.AUTO_STATUS_VIEW,  true),
        like:  bool(process.env.AUTO_STATUS_LIKE,  true),
        reply: bool(process.env.AUTO_STATUS_REPLY, false)
    },

    autoGreet:       bool(process.env.AUTO_GREET,       false),
    welcomeMessage:  bool(process.env.WELCOME_MESSAGE,  true),
    goodbyeMessage:  bool(process.env.GOODBYE_MESSAGE,  true),
    statusReplyText: str(process.env.STATUS_REPLY_TEXT, "Nice status! ✨"),

    autoblock: list(process.env.AUTOBLOCK, []),

    // ---- External API keys (read but not used here yet) ----
    rapidApiKey:   str(process.env.RAPIDAPI_KEY,   ""),
    rapidApiHost:  str(process.env.RAPIDAPI_HOST,  ""),
    searchApiHost: str(process.env.SEARCH_API_HOST,""),
    weatherApiKey: str(process.env.WEATHER_API_KEY,""),
    newsApiKey:    str(process.env.NEWS_API_KEY,   ""),
    toosiiApiKey:  str(process.env.TOOSII_API_KEY, ""),
    paystackKey:   str(process.env.PAYSTACK_SECRET_KEY, ""),
    stripeKey:     str(process.env.STRIPE_SECRET_KEY,   ""),

    jwtSecret: str(process.env.JWT_SECRET, ""),

    logLevel: str(process.env.LOG_LEVEL, "silent"),

    scamWords: ["free money", "lottery", "winner", "cash prize", "claim your prize"],
    pornWords: ["porn", "xxx", "nsfw", "nude"]
};