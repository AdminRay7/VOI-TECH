const fs = require("fs");
const path = require("path");

module.exports = {
    name: "menu",
    aliases: ["help", "commands"],
    description: "Show bot menu",
    async execute(conn, msg, args, ctx) {
        const { config } = ctx;
        const cmdDir = path.join(__dirname, "..");
        const files = [];
        const walk = (d) => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (f.name.startsWith(".")) continue;
                const full = path.join(d, f.name);
                if (f.isDirectory()) walk(full);
                else if (f.name.endsWith(".js")) files.push(full);
            }
        };
        try { walk(cmdDir); } catch {}

        const seen = new Set();
        const lines = [];
        for (const f of files) {
            try {
                const mod = require(f);
                if (!mod?.name || seen.has(mod.name)) continue;
                seen.add(mod.name);
                lines.push(`• ${config.prefix}${mod.name}${mod.aliases?.length ? ` (${mod.aliases.map(a => config.prefix + a).join(", ")})` : ""} — ${mod.description || ""}`);
            } catch {}
        }

        const text =
`╭─❏ *${config.botName}*
│ ${config.footer}
│ v${config.version}
╰───────────────
${lines.join("\n")}

_Prefix: ${config.prefix}_`;

        await conn.sendMessage(ctx.from, { text }, { quoted: msg });
    }
};