// commands/jid.js
const { fancy } = require('../lib/font');

module.exports = {
    name: 'jid',
    category: 'general',
    aliases: ['chatid', 'id'],
    description: 'Get the current chat JID',
    async execute(conn, msg, args, ctx) {
        const { from } = ctx;
        await conn.sendMessage(from, { text: fancy(`🆔 *Chat JID:*\n${from}`) }, { quoted: msg });
    }
};