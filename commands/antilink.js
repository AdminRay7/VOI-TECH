// commands/antilink.js
// Smart Anti-link — uses AI to check if a link is spam or normal chat.
// Works session-wide (groups only).
// Toggle: .antilink on | off | (no args = show state)

const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');
const aiChat = require('../lib/aiChat');

// Basic regex to detect if a message contains a link (to save AI quota)
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

function bareNum(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function isBotGroupAdmin(conn, groupJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        const botBare = bareNum(conn.user?.id);
        const botLidBare = bareNum(conn.user?.lid);
        const me = meta.participants.find(p => {
            const pidBare = bareNum(p.id);
            return pidBare === botBare || (botLidBare && pidBare === botLidBare);
        });
        if (!me) return false;
        return me.admin === 'admin' || me.admin === 'superadmin';
    } catch { return false; }
}

async function isGroupAdmin(conn, groupJid, senderJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        const senderBare = bareNum(senderJid);
        return meta.participants.some(p =>
            bareNum(p.id) === senderBare &&
            (p.admin === 'admin' || p.admin === 'superadmin')
        );
    } catch { return false; }
}

module.exports = {
    name: 'antilink',
    category: 'auto',
    aliases: ['al'],
    description: 'Smart anti-link (AI-powered context check)',
    toggleKey: 'antilink',
    enabled: () => true,

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId } = ctx;
        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') });
        if (!isGroup)  return conn.sendMessage(from, { text: fancy('❌ Group only command.') });

        if (!(await isBotGroupAdmin(conn, from))) {
            return conn.sendMessage(from, { text: fancy('❌ I must be a group admin to use this.') });
        }

        const action = (args[0] || '').toLowerCase();

        if (action === '') {
            const on = await autoToggles.get(userId, 'antilink', null, config.antilink === true);
            return conn.sendMessage(from, {
                text: fancy(`🔗 Smart Anti-Link: ${on ? '✅ ON' : '❌ OFF'}\n\nUses AI to detect spam links.`)
            }, { quoted: msg });
        }
        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, { text: fancy(`Usage: ${config.prefix}antilink on|off`) });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'antilink', null, value);
        return conn.sendMessage(from, {
            text: fancy(`✅ Smart Anti-Link ${value ? 'ENABLED' : 'DISABLED'}.`)
        }, { quoted: msg });
    },

    // ============================================================
    //   ENFORCEMENT
    // ============================================================
    async onMessage(conn, msg, ctx) {
        const { from, sender, isGroup, isOwner, body, userId } = ctx;

        if (!isGroup) return false;
        if (isOwner) return false;
        if (msg.key.fromMe) return false;
        if (!body || !body.trim()) return false;

        // 1. Quick check: If there is no URL at all, ignore (saves AI quota)
        if (!URL_REGEX.test(body)) return false;

        // 2. Exempt group admins
        if (await isGroupAdmin(conn, from, sender)) return false;

        // 3. Bot must be group admin to delete
        if (!(await isBotGroupAdmin(conn, from))) return false;

        // 4. AI Context Check
        const prompt = `Message: "${body}"\nIs this message trying to advertise, promote, or spam a link? Reply with exactly one word: YES or NO.`;
        const sys = "You are a strict spam filter. Reply only YES or NO.";
        
        let aiVerdict = "YES"; // Default to delete if AI fails
        try {
            const reply = await aiChat.askAI(prompt, "antilink_" + userId, sys);
            if (reply) aiVerdict = reply.trim().toUpperCase();
        } catch (e) {
            console.error("[antilink] AI check failed:", e.message);
        }

        // If AI says NO (it's a normal conversation link), allow it.
        if (aiVerdict === "NO") {
            console.log(`[antilink] AI allowed link: "${body}"`);
            return false;
        }

        // 5. Delete the message (AI said YES)
        try {
            await conn.sendMessage(from, { delete: msg.key });
            console.log(`[antilink] AI blocked link: "${body}"`);
        } catch (e) {
            console.error('[antilink] delete failed:', e.message);
            return false;
        }

        // 6. Warn the sender
        try {
            const senderBare = bareNum(sender);
            await conn.sendMessage(from, {
                text: fancy(`⚠️ @${senderBare}, promotional links are not allowed here.`),
                mentions: [sender]
            });
        } catch (e) {
            console.error('[antilink] warn failed:', e.message);
        }

        return true;
    }
};