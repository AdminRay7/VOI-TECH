// commands/autogreet.js
const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');

// Simple memory cache to prevent spam
const greetedRecently = new Map();

module.exports = {
    name: 'autogreet',
    category: 'auto',
    aliases: ['ag'],
    description: 'Auto-greet new members or users',
    toggleKey: 'autogreet',

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId, prefix } = ctx;
        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });

        const action = (args[0] || '').toLowerCase();
        if (action === '') {
            const on = await autoToggles.get(userId, 'autogreet', null, false);
            return conn.sendMessage(from, { text: fancy(`👋 Auto-Greet: ${on ? '✅ ON' : '❌ OFF'}`) }, { quoted: msg });
        }
        if (!['on', 'off'].includes(action)) return conn.sendMessage(from, { text: fancy(`Usage: ${prefix}autogreet on|off`) }, { quoted: msg });

        const value = action === 'on';
        await autoToggles.set(userId, 'autogreet', null, value);
        return conn.sendMessage(from, { text: fancy(`✅ Auto-Greet ${value ? 'ENABLED' : 'DISABLED'}.`) }, { quoted: msg });
    },

    async onGroupJoin(conn, groupJid, participants, ctx) {
        const { userId } = ctx;
        const on = await autoToggles.get(userId, 'autogreet', null, false);
        if (!on) return;

        for (const p of participants) {
            const jid = p.id || p;
            try {
                await conn.sendMessage(groupJid, {
                    text: fancy(`👋 Hello @${jid.split('@')[0]}! Welcome to the group.`),
                    mentions: [jid]
                });
            } catch (e) {}
        }
    }
};