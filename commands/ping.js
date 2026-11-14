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

        // 303-XMD Branding
        const pongText = `𝐏𝛐𝛈𝐠! ⚡ 𝐬𝐩𝐞𝐞𝐝: ${latency} ms\n\n> 303-XMD — THE LAST KEY`;

        const messageContent = { text: pongText };

        // Use the Newsletter JID from .env to create the Channel Button
        if (config.newsletterJid) {
            messageContent.footer = "303-XMD Channel";
            messageContent.templateButtons = [
                { 
                    name: "cta_url", 
                    buttonParamsJson: JSON.stringify({
                        display_text: "View Channel",
                        // Use the JID directly in the URL format
                        url: `https://wa.me/channel/${config.newsletterJid.split('@')[0]}`, 
                        merchant_url: `https://wa.me/channel/${config.newsletterJid.split('@')[0]}`
                    })
                }
            ];
        }

        try {
            // Edit the "Pinging..." message to show the final result and button
            await conn.sendMessage(from, { 
                ...messageContent,
                edit: sent.key 
            });
        } catch (e) {
            // Fallback: If editing fails, send as a new message
            await conn.sendMessage(from, messageContent, { quoted: msg });
        }
    }
};