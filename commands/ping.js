module.exports = {
    name: "ping",
    aliases: ["p"],
    description: "Check bot latency",
    async execute(conn, msg, args, ctx) {
        try {
            const start = Date.now();
            // Send the initial ping
            await conn.sendMessage(ctx.from, { text: "🏓 pinging..." }, { quoted: msg });
            
            // Calculate latency
            const latency = Date.now() - start;
            
            // Send the pong
            await conn.sendMessage(ctx.from, { 
                text: `🏓 *Pong!*\n⚡ Latency: ${latency}ms` 
            }, { quoted: msg });
            
        } catch (error) {
            console.error("Ping command error:", error);
        }
    }
};