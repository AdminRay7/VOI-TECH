// commands/tagall.js
const { fancy } = require('../lib/font');

module.exports = {
    name: 'tagall',
    category: 'group',
    aliases: ['everyone', 'mentionall'],
    description: 'Mention everyone in the group',
    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, isGroupAdmin, sender, prefix } = ctx;
        
        if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') }, { quoted: msg });
        if (!isOwner && !isGroupAdmin) return conn.sendMessage(from, { text: fancy('❌ Admin or Owner only.') }, { quoted: msg });

        try {
            const meta = await conn.groupMetadata(from);
            const participants = meta.participants.map(p => p.id);
            const text = args.join(' ') || 'Attention everyone!';
            
            let mentionsText = `📢 *${text}*\n\n`;
            for (const p of participants) {
                mentionsText += `@${p.split('@')[0]}\n`;
            }

            await conn.sendMessage(from, {
                text: fancy(mentionsText),
                mentions: participants
            }, { quoted: msg });

        } catch (e) {
            await conn.sendMessage(from, { text: fancy('❌ Failed to fetch group members.') }, { quoted: msg });
        }
    }
};