// commands/anticall.js
// Anti-call — auto-rejects incoming WhatsApp calls when ON.
// Toggle: .anticall on | off | (no args = show state)
// Session-wide (applies to every chat in this session).

const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'anticall',
    category: 'auto',
    aliases: ['ac'],
    description: 'Auto-reject incoming calls when ON',
    toggleKey: 'anticall',
    enabled: () => true,

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') });
        }

        const action = (args[0] || '').toLowerCase();

        // show state
        if (action === '') {
            const on = await autoToggles.get(userId, 'anticall', null, config.anticall === true);
            return conn.sendMessage(from, {
                text: fancy(
                    `📞 Anti-Call (session-wide)\n\n` +
                    `Status: ${on ? '✅ ON' : '❌ OFF'}\n` +
                    `Incoming calls are ${on ? 'auto-rejected' : 'allowed'}`
                )
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, { text: fancy(`Usage: ${config.prefix}anticall on|off`) });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'anticall', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Anti-Call ${value ? 'ENABLED' : 'DISABLED'}.`)
        }, { quoted: msg });
    },

    // ============================================================
    //   ENFORCEMENT — fired by handler.handleCallEvent()
    //   Only runs when toggle is ON for the session.
    // ============================================================
    async onCall(conn, calls) {
        for (const call of calls) {
            if (call.status !== 'offer') continue;
            try {
                await conn.rejectCall(call.id, call.from);
                console.log(`[anticall] rejected call from ${call.from}`);
            } catch (e) {
                console.error('[anticall] reject failed:', e.message);
            }
        }
        return true;
    }
};