// commands/antimedia.js
// Block media types in groups — one command, multiple sub-toggles.

const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

const SUBTYPES = ['photo', 'video', 'sticker', 'audio', 'voice', 'document', 'status'];

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
        console.error(`[antimedia] Metadata fetch failed for ${groupJid}:`, e.message);
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

// Map sub-type → toggle key
function keyFor(sub) {
    return `antimedia_${sub}`;
}

// Check what media type a message is
function detectMedia(msg) {
    const type = Object.keys(msg.message || {})[0];
    const map = {
        imageMessage:    'photo',
        videoMessage:    'video',
        ptvMessage:      'video',
        stickerMessage:  'sticker',
        audioMessage:    msg.message.audioMessage?.ptt ? 'voice' : 'audio',
        documentMessage: 'document'
    };
    return map[type] || null;
}

// Check if message is a status mention
function isStatusMention(msg) {
    const inner = msg.message || {};
    const ext = inner.extendedTextMessage || inner.imageMessage || inner.videoMessage;
    const mentioned = ext?.contextInfo?.mentionedJid || [];
    return mentioned.includes('status@broadcast');
}

module.exports = {
    name: 'antimedia',
    category: 'auto',
    aliases: ['am'],
    description: 'Block media types in a group',
    toggleKey: 'antimedia',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId, prefix } = ctx;

        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') }, { quoted: msg });
        
        const meta = await getGroupMeta(conn, from);
        if (!botIsAdmin(meta, conn)) {
            return conn.sendMessage(from, { text: fancy('❌ I must be a group admin to use this.') }, { quoted: msg });
        }

        const a = (args[0] || '').toLowerCase();
        const b = (args[1] || '').toLowerCase();

        // ---------- .antimedia (no args) — show all states ----------
        if (!a) {
            const lines = ['📵 *ANTI-MEDIA — current state*', ''];
            for (const sub of SUBTYPES) {
                const on = await autoToggles.get(userId, keyFor(sub), from, false);
                lines.push(`${on ? '✅' : '❌'} ${sub}`);
            }
            lines.push('');
            lines.push(`Usage: ${prefix}antimedia <type> on|off`);
            lines.push(`       ${prefix}antimedia on|off  (all)`);
            return conn.sendMessage(from, { text: fancy(lines.join('\n')) }, { quoted: msg });
        }

        // ---------- .antimedia on|off — bulk ----------
        if (a === 'on' || a === 'off') {
            const value = a === 'on';
            for (const sub of SUBTYPES) {
                await autoToggles.set(userId, keyFor(sub), from, value);
            }
            return conn.sendMessage(from, {
                text: fancy(`✅ All media blocks ${value ? 'ENABLED' : 'DISABLED'}.`)
            }, { quoted: msg });
        }

        // ---------- .antimedia <sub> on|off ----------
        if (!SUBTYPES.includes(a)) {
            return conn.sendMessage(from, {
                text: fancy(`❌ Unknown type: ${a}\n\nTypes: ${SUBTYPES.join(', ')}`)
            }, { quoted: msg });
        }

        // Show single state if no on/off
        if (!b) {
            const on = await autoToggles.get(userId, keyFor(a), from, false);
            return conn.sendMessage(from, {
                text: fancy(`${on ? '✅' : '❌'} ${a}: ${on ? 'ON' : 'OFF'}`)
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(b)) {
            return conn.sendMessage(from, {
                text: fancy(`Usage: ${prefix}antimedia ${a} on|off`)
            }, { quoted: msg });
        }

        const value = b === 'on';
        await autoToggles.set(userId, keyFor(a), from, value);
        return conn.sendMessage(from, {
            text: fancy(`✅ ${a} ${value ? 'ENABLED' : 'DISABLED'}.`)
        }, { quoted: msg });
    },

    // ============================================================
    //   ENFORCEMENT
    // ============================================================
    async onMessage(conn, msg, ctx) {
        const { from, sender, isGroup, isOwner, userId } = ctx;

        if (!isGroup) return false;
        if (isOwner) return false;
        if (msg.key.fromMe) return false;

        // Fetch metadata ONCE (cached for 60s)
        const meta = await getGroupMeta(conn, from);
        if (!meta) {
            // console.log(`[antimedia] Skipped: Could not fetch metadata.`);
            return false;
        }

        // 1. Check status mention
        const statusOn = await autoToggles.get(userId, keyFor('status'), from, false);
        if (statusOn && isStatusMention(msg)) {
            if (participantIsAdmin(meta, sender)) return false;
            if (!botIsAdmin(meta, conn)) {
                console.log(`[antimedia] Status mention detected but bot not admin.`);
                return false;
            }
            try {
                await conn.sendMessage(from, { delete: msg.key });
                await conn.sendMessage(from, { text: fancy('📱 Status mentions not allowed here.') });
            } catch (e) { console.error('[antimedia] status delete failed:', e.message); }
            return true;
        }

        // 2. Detect media type
        const mediaType = detectMedia(msg);
        if (!mediaType) return false;

        // 3. Is this type blocked?
        const on = await autoToggles.get(userId, keyFor(mediaType), from, false);
        if (!on) return false;

        // 4. Admin exempt
        if (participantIsAdmin(meta, sender)) return false;

        // 5. Bot must be admin
        if (!botIsAdmin(meta, conn)) {
            console.log(`[antimedia] ${mediaType} blocked but bot not admin.`);
            return false;
        }

        // 6. Delete + warn
        try {
            await conn.sendMessage(from, { delete: msg.key });
            console.log(`[antimedia] Deleted ${mediaType} from ${bareNum(sender)}`);
        } catch (e) {
            console.error(`[antimedia] delete ${mediaType} failed:`, e.message);
            return false;
        }

        try {
            await conn.sendMessage(from, {
                text: fancy(`📵 ${mediaType} not allowed here.`)
            });
        } catch {}

        return true;
    },

    // Clear cache on join/leave
    async onGroupJoin(conn, groupJid) { metaCache.delete(groupJid); },
    async onGroupLeave(conn, groupJid) { metaCache.delete(groupJid); }
};