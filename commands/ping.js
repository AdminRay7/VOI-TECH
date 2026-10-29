module.exports = {
    name: "ping",
    category: "general",
    aliases: ["p"],
    description: "Check bot latency",
    async execute(conn, msg, args, ctx) {
        try {
            const start = Date.now();
            await conn.sendMessage(ctx.from, { text: "🏓 pinging..." }, { quoted: msg });
            
            const latency = Date.now() - start;
            
            // USE FANCY HERE
            await conn.sendMessage(ctx.from, { 
                text: `🏓 *${ctx.fancy("Pong!")}*\n⚡ Latency: ${latency}ms` 
            }, { quoted: msg });
            
        } catch (error) {
            console.error("Ping command error:", error);
        }
    }
};