module.exports = {
    name: "antilink",
    category: "anti",
    description: "Toggle anti-link protection (on/off)",
    async execute(conn, msg, args, ctx) {
        if (!ctx.isGroup) return ctx.reply("❌ This command is only for groups.");
        if (!ctx.isOwner && !ctx.isAdmin)
            return ctx.reply("❌ You must be an admin or the owner.");

        if (!global.antiLinkGroups) global.antiLinkGroups = new Set();

        // Safe fancy: fall back to plain text if fancy isn't callable
        const f = (s) => {
            try { return typeof ctx.fancy === "function" ? ctx.fancy(s) : s; }
            catch { return s; }
        };

        const action = (args[0] || "").toLowerCase();

        if (action === "on") {
            global.antiLinkGroups.add(ctx.from);
            return ctx.reply(`✅ Anti-Link is now ${f("ENABLED")} for this group.`);
        }
        if (action === "off") {
            global.antiLinkGroups.delete(ctx.from);
            return ctx.reply(`❌ Anti-Link is now ${f("DISABLED")} for this group.`);
        }

        const current = global.antiLinkGroups.has(ctx.from) ? "ON" : "OFF";
        return ctx.reply(
            `Anti-Link is currently *${current}*.\n` +
            `Usage: \`.antilink on\` / \`.antilink off\``
        );
    }
};