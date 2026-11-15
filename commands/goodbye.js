// commands/goodbye.js
const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'goodbye',
    category: 'group',
    aliases: ['gb'],
    description: 'Toggle goodbye messages for leaving members',
    toggleKey: 'goodbye',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId, prefix } = ctx;
        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') }, { quoted: msg });

        const action = (args[0] || '').toLowerCase();
        if (action === '') {
            const on = await autoToggles.get(userId, 'goodbye', from, false);
            return conn.sendMessage(from, { text: fancy(`👋 Goodbye Messages: ${on ? '✅ ON' : '❌ OFF'}`) }, { quoted: msg });
        }
        if (!['on', 'off'].includes(action)) return conn.sendMessage(from, { text: fancy(`Usage: ${prefix}goodbye on|off`) }, { quoted: msg });

        const value = action === 'on';
        await autoToggles.set(userId, 'goodbye', from, value);
        return conn.sendMessage(from, { text: fancy(`✅ Goodbye Messages ${value ? 'ENABLED' : 'DISABLED'}.`) }, { quoted: msg });
    },

    async onGroupLeave(conn, groupJid, participants, ctx) {
        const { userId } = ctx;
        const on = await autoToggles.get(userId, 'goodbye', groupJid, false);
        if (!on) return;

        for (const p of participants) {
            const jid = p.id || p;
            try {
                await conn.sendMessage(groupJid, {
                    text: fancy(`👋 Goodbye @${jid.split('@')[0]}! We'll miss you.`),
                    mentions: [jid]
                });
            } catch (e) {}
        }
    }
};