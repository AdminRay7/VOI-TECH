// commands/antibug.js
// Anti-bug — detects and removes malicious unicode (zalgo), zero-width
// characters, and oversized messages that crash or freeze WhatsApp clients.
// Toggle: .antibug on | off | (no args = show state)
// Scope: session-wide (all groups + DMs). OWNER ONLY.

const path = require('path');
const autoToggles = require(path.join(__dirname, '..', 'lib', 'autoToggles'));
const { fancy } = require(path.join(__dirname, '..', 'lib', 'font'));
const config = require(path.join(__dirname, '..', 'config'));

function bareNum(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// ============================================================
//   GROUP METADATA CACHE (Prevents Heroku Rate-Limit Crashes)
// ============================================================
const metaCache = new Map();
const META_TTL_MS = 60_000;

async function getGroupMeta(conn, groupJid) {
    const hit = metaCache.get(groupJid);
    if (hit && Date.now() - hit.ts < META_TTL_MS) return hit.meta;
    try {
        const meta = await conn.groupMetadata(groupJid);
        metaCache.set(groupJid, { meta, ts: Date.now() });
        return meta;
    } catch (e) {
        metaCache.set(groupJid, { meta: null, ts: Date.now() });
        return null;
    }
}

function botIsAdmin(meta, conn) {
    if (!meta || !Array.isArray(meta.participants)) return false;
    const botBare = bareNum(conn.user?.id);
    const botLid = bareNum(conn.user?.lid);
    const me = meta.participants.find(p => {
        const pb = bareNum(p.id);
        return pb === botBare || (botLid && pb === botLid);
    });
    return me && (me.admin === 'admin' || me.admin === 'superadmin');
}

function participantIsAdmin(meta, sender) {
    if (!meta || !Array.isArray(meta.participants)) return false;
    const sb = bareNum(sender);
    return meta.participants.some(p =>
        bareNum(p.id) === sb && (p.admin === 'admin' || p.admin === 'superadmin')
    );
}

// ============================================================
//   BUG DETECTION
// ============================================================
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/;
const RTL_CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

function hasZalgo(text) {
    if (!text) return false;
    const combining = text.match(/[\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g);
    return combining && combining.length > 15;
}

const MAX_MESSAGE_LENGTH = 5000;

const KNOWN_PATTERNS = [
    /[\u202E\u202D]{5,}/,
    /\u200B{10,}/,
    /\u061C{10,}/,
    /[\u202A-\u202E]{3,}/
];

function detectBug(text) {
    if (!text) return null;

    if (text.length > MAX_MESSAGE_LENGTH) {
        return { reason: 'oversized_message', detail: `${text.length} chars` };
    }
    if (hasZalgo(text)) {
        return { reason: 'zalgo', detail: 'excessive combining marks' };
    }
    if (ZERO_WIDTH.test(text)) {
        return { reason: 'zero_width', detail: 'invisible characters detected' };
    }
    if (RTL_CONTROL.test(text)) {
        return { reason: 'rtl_control', detail: 'RTL override detected' };
    }
    for (const pat of KNOWN_PATTERNS) {
        if (pat.test(text)) {
            return { reason: 'known_pattern', detail: 'matched known crash pattern' };
        }
    }
    return null;
}

// ============================================================
//   COMMAND
// ============================================================
module.exports = {
    name: 'antibug',
    category: 'auto',
    aliases: ['ab'],
    description: 'Toggle anti-bug (blocks malicious unicode / zalgo / oversize)',
    toggleKey: 'antibug',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId } = ctx;

        // 🔒 OWNER ONLY LOCK
        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        if (isGroup) {
            const meta = await getGroupMeta(conn, from);
            if (!botIsAdmin(meta, conn)) {
                await conn.sendMessage(from, {
                    text: fancy('⚠️ Note: I am not an admin here. I can turn on Anti-Bug, but I cannot delete messages until you promote me.')
                }, { quoted: msg });
            }
        }

        const action = (args[0] || '').toLowerCase();

        if (action === '') {
            const on = await autoToggles.get(userId, 'antibug', null, config.antibug === true);
            return conn.sendMessage(from, {
                text: fancy(
                    `🐛 Anti-Bug (session-wide)\n\n` +
                    `Status: ${on ? '✅ ON' : '❌ OFF'}\n` +
                    `Blocks: zalgo, zero-width, RTL overrides, oversize`
                )
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, { text: fancy(`Usage: ${config.prefix}antibug on|off`) }, { quoted: msg });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'antibug', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Anti-Bug ${value ? 'ENABLED' : 'DISABLED'} (all groups + DMs).`)
        }, { quoted: msg });
    },

    // ============================================================
    //   ENFORCEMENT
    // ============================================================
    async onMessage(conn, msg, ctx) {
        const { from, sender, isGroup, isOwner, body, userId } = ctx;

        if (isOwner) return false;
        if (msg.key.fromMe) return false;
        if (!body || !body.trim()) return false;

        // 1. Check toggle
        const on = await autoToggles.get(userId, 'antibug', null, config.antibug === true);
        if (!on) return false;

        // 2. Detect bug
        const bug = detectBug(body);
        if (!bug) return false;

        // 3. Group specific checks
        if (isGroup) {
            const meta = await getGroupMeta(conn, from);
            if (!meta) return false;
            
            // Exempt admins
            if (participantIsAdmin(meta, sender)) return false;
            
            // Bot must be admin to delete
            if (!botIsAdmin(meta, conn)) {
                console.log(`[antibug] Bug detected but bot not admin in ${from}`);
                return false;
            }
        }

        // 4. Delete the bug message
        try {
            await conn.sendMessage(from, { delete: msg.key });
        } catch (e) {
            console.error('[antibug] delete failed:', e.message);
            return false;
        }

        // 5. Warn the chat
        try {
            await conn.sendMessage(from, {
                text: fancy('🐛 *BUG DETECTED*')
            });
        } catch (e) {
            console.error('[antibug] warn failed:', e.message);
        }

        return true;
    }
};