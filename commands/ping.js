// commands/ping.js
module.exports = {
    name: 'ping',
    category: 'general',
    aliases: ['p', 'speed'],
    description: 'Check bot speed',
    async execute(conn, msg, args, ctx) {
        const { from, config } = ctx;
        const t0 = Date.now();

        const sent = await conn.sendMessage(from, { text: '𝐏𝐢𝐧𝐠𝐢𝐧𝐠...' }, { quoted: msg });
        const latency = Date.now() - t0;

        const pongText = `⚡ 𝐏𝛐𝛈𝐠! ⚡ 𝐬𝐩𝐞𝐞𝐝: ${latency} ms\n\n> 303-XMD — THE LAST KEY`;

        try {
            // Edit the original message with the new text and the Newsletter Button
            await conn.sendMessage(from, { 
                text: pongText,
                edit: sent.key,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: config.newsletterJid || '120363430114825309@newsletter',
                        newsletterName: config.botName || '303-XMD',
                        serverMessageId: -1
                    }
                }
            });
        } catch (e) {
            // Fallback: If editing fails, send as a new message with the button
            await conn.sendMessage(from, { 
                text: pongText,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: config.newsletterJid || '120363430114825309@newsletter',
                        newsletterName: config.botName || '303-XMD',
                        serverMessageId: -1
                    }
                }
            }, { quoted: msg });
        }
    }
};