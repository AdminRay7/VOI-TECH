module.exports = {
    name: "owner",
    aliases: ["creator", "dev"],
    description: "Show owner contact",
    async execute(conn, msg, args, ctx) {
        const { config } = ctx;
        const num = String(config.ownerNumber || "").replace(/\D/g, "");
        const jid = num ? `${num}@s.whatsapp.net` : null;
        const text =
`👑 *Owner*
• Name: ${config.ownerName || "Unknown"}
• Number: ${num || "—"}
• Channel: ${config.channelLink || "—"}`;

        if (jid) {
            await conn.sendMessage(ctx.from, {
                text,
                mentions: [jid]
            }, { quoted: msg });
        } else {
            await conn.sendMessage(ctx.from, { text }, { quoted: msg });
        }
    }
};