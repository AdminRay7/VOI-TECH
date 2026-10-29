module.exports = {
    name: "ping",
    aliases: ["p"],
    description: "Check bot latency",
    async execute(conn, msg, args, ctx) {
        const start = Date.now();
        await conn.sendMessage(ctx.from, { text: "🏓 pinging..." }, { quoted: msg });
        const latency = Date.now() - start;
        await conn.sendMessage(ctx.from, {
            text: `🏓 *Pong!*\n⚡ Latency: ${latency}ms`
        }, { quoted: msg });
    }
};