// commands/autoread.js
const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');

module.exports = {
    name: 'autoread',
    category: 'auto',
    aliases: ['ar'],
    description: 'Auto-read all incoming messages',
    toggleKey: 'autoread',

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId, prefix } = ctx;
        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        
        const action = (args[0] || '').toLowerCase();
        if (action === '') {
            const on = await autoToggles.get(userId, 'autoread', null, false);
            return conn.sendMessage(from, { text: fancy(`📖 Auto-Read: ${on ? '✅ ON' : '❌ OFF'}`) }, { quoted: msg });
        }
        if (!['on', 'off'].includes(action)) return conn.sendMessage(from, { text: fancy(`Usage: ${prefix}autoread on|off`) }, { quoted: msg });

        const value = action === 'on';
        await autoToggles.set(userId, 'autoread', null, value);
        return conn.sendMessage(from, { text: fancy(`✅ Auto-Read ${value ? 'ENABLED' : 'DISABLED'}.`) }, { quoted: msg });
    },

    async onMessage(conn, msg, ctx) {
        const { userId, isStatus } = ctx;
        const on = await autoToggles.get(userId, 'autoread', null, false);
        if (!on) return false;

        // Don't read statuses here if you want statusview to handle it
        if (isStatus) return false; 

        try {
            await conn.readMessages([msg.key]);
        } catch (e) {}
        return false;
    }
};