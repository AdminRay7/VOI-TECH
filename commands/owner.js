module.exports = {
    name: "owner",
    aliases: ["creator", "dev"],
    description: "Show owner contact",
    async execute(conn, msg, args, ctx) {
        try {
            const { config } = ctx;
            const num = String(config.ownerNumber || "").replace(/\D/g, "");
            const jid = num ? `${num}@s.whatsapp.net` : null;
            
            const text = `👑 *Owner*\n• Name: ${config.ownerName || "Unknown"}\n• Number: ${num || "—"}\n• Channel: ${config.channelLink || "—"}`;

            if (jid) {
                await conn.sendMessage(ctx.from, {
                    text,
                    mentions: [jid]
                }, { quoted: msg });
            } else {
                await conn.sendMessage(ctx.from, { text }, { quoted: msg });
            }
        } catch (error) {
            console.error("Owner command error:", error);
        }
    }
};