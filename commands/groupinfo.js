// commands/groupinfo.js
const { fancy } = require('../lib/font');

module.exports = {
    name: 'groupinfo',
    category: 'group',
    aliases: ['ginfo', 'gid'],
    description: 'Get group information and JID',
    async execute(conn, msg, args, ctx) {
        const { from, isGroup } = ctx;
        if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') }, { quoted: msg });

        try {
            const meta = await conn.groupMetadata(from);
            const creation = new Date(meta.creation * 1000).toLocaleString();
            const owner = meta.owner ? meta.owner.split('@')[0] : 'Unknown';
            
            const text = 
                `📁 *GROUP INFO*\n\n` +
                `📛 *Name:* ${meta.subject}\n` +
                `🆔 *Group JID:* ${from}\n` +
                `📅 *Created:* ${creation}\n` +
                `👥 *Members:* ${meta.participants.length}\n` +
                `👑 *Owner:* ${owner}\n` +
                `📝 *Desc:* ${meta.desc || 'None'}`;

            await conn.sendMessage(from, { text: fancy(text) }, { quoted: msg });
        } catch (e) {
            await conn.sendMessage(from, { text: fancy('❌ Failed to fetch group info.') }, { quoted: msg });
        }
    }
};