// commands/welcome.js
const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'welcome',
    category: 'group',
    aliases: ['wc'],
    description: 'Toggle welcome messages for new members',
    toggleKey: 'welcome',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId, prefix } = ctx;
        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') }, { quoted: msg });

        const action = (args[0] || '').toLowerCase();
        if (action === '') {
            const on = await autoToggles.get(userId, 'welcome', from, false);
            return conn.sendMessage(from, { text: fancy(`👋 Welcome Messages: ${on ? '✅ ON' : '❌ OFF'}`) }, { quoted: msg });
        }
        if (!['on', 'off'].includes(action)) return conn.sendMessage(from, { text: fancy(`Usage: ${prefix}welcome on|off`) }, { quoted: msg });

        const value = action === 'on';
        await autoToggles.set(userId, 'welcome', from, value);
        return conn.sendMessage(from, { text: fancy(`✅ Welcome Messages ${value ? 'ENABLED' : 'DISABLED'}.`) }, { quoted: msg });
    },

    async onGroupJoin(conn, groupJid, participants, ctx) {
        const { userId } = ctx;
        const on = await autoToggles.get(userId, 'welcome', groupJid, false);
        if (!on) return;

        for (const p of participants) {
            const jid = p.id || p;
            try {
                const meta = await conn.groupMetadata(groupJid);
                await conn.sendMessage(groupJid, {
                    text: fancy(`👋 Welcome to *${meta.subject}*!\n\n@${jid.split('@')[0]}, we're glad to have you here.`),
                    mentions: [jid]
                });
            } catch (e) {}
        }
    }
};