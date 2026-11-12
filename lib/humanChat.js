// lib/humanChat.js
// Stores recent group messages for AI context and summaries.

const contexts = new Map();
const MAX_MESSAGES = 50;
const TTL_MS = 60 * 60 * 1000; // 1 hour

function pushContext(groupJid, senderName, text) {
    let msgs = contexts.get(groupJid);
    if (!msgs) {
        msgs = [];
        contexts.set(groupJid, msgs);
    }
    msgs.push({ sender: senderName, text, ts: Date.now() });
    if (msgs.length > MAX_MESSAGES) msgs.shift();
}

function getContext(groupJid, minutes = 15) {
    const msgs = contexts.get(groupJid);
    if (!msgs) return '';
    
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recent = msgs.filter(m => m.ts > cutoff);
    
    return recent.map(m => `${m.sender}: ${m.text}`).join('\n');
}

function clearContext(groupJid) {
    contexts.delete(groupJid);
}

function hasReplied(msgId) {
    // Simple dedup for the current minute
    const now = Date.now();
    if (!global.__repliedCache) global.__repliedCache = new Map();
    if (global.__repliedCache.has(msgId)) return true;
    global.__repliedCache.set(msgId, now);
    
    // Cleanup old cache
    for (const [k, v] of global.__repliedCache) {
        if (now - v > 60000) global.__repliedCache.delete(k);
    }
    return false;
}

function humanize(text) {
    if (!text) return '';
    return text
        .replace(/[\*\_~`#]/g, '') // remove markdown
        .replace(/^(AI|Bot):/i, '') // remove AI prefix
        .trim();
}

// Cleanup old contexts
setInterval(() => {
    const now = Date.now();
    for (const [jid, msgs] of contexts) {
        if (msgs.length === 0 || now - msgs[msgs.length - 1].ts > TTL_MS) {
            contexts.delete(jid);
        }
    }
}, 10 * 60 * 1000).unref();

module.exports = { pushContext, getContext, clearContext, hasReplied, humanize };