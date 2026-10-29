module.exports = {
    name: "up",
    aliases: ["uptime", "runtime"],
    description: "Check how long the bot has been running",
    async execute(conn, msg, args, ctx) {
        try {
            let uptimeSeconds = process.uptime();
            const days = Math.floor(uptimeSeconds / (24 * 60 * 60));
            uptimeSeconds %= (24 * 60 * 60);
            const hours = Math.floor(uptimeSeconds / (60 * 60));
            uptimeSeconds %= (60 * 60);
            const minutes = Math.floor(uptimeSeconds / 60);
            const seconds = Math.floor(uptimeSeconds % 60);

            let timeString = "";
            if (days > 0) timeString += `${days}d `;
            if (hours > 0) timeString += `${hours}h `;
            if (minutes > 0) timeString += `${minutes}m `;
            timeString += `${seconds}s`;

            const text = `╭─── • ⏱️ • ───╮\n   *${ctx.config.botName} Uptime*\n╰─── • ⏱️ • ───╯\n\nI have been running for:\n*${timeString.trim()}*`;

            await conn.sendMessage(ctx.from, { text }, { quoted: msg });

        } catch (error) {
            console.error("Uptime command error:", error);
            await conn.sendMessage(ctx.from, { text: "❌ Failed to calculate uptime." }, { quoted: msg });
        }
    }
};