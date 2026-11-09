module.exports = {
    name: "autoreactstatus",
    category: "settings",
    aliases: ["autoreact", "reactstatus"],
    description: "Toggle auto-react to statuses (on/off)",

    async execute(conn, msg, args, ctx) {
        // Initialize global states if they don't exist yet
        if (global.autoReactStatus === undefined) global.autoReactStatus = true;
        if (!global.autoReactEmojis) global.autoReactEmojis = ["❤️", "🔥", "💯", "✨", "👑", "🚀", "🙌"];

        const action = args[0]?.toLowerCase();
        
        if (action === "set" && args.length > 1) {
            // Allow user to set custom emojis: .autoreact set ❤️,🔥,😍
            const newEmojis = args.slice(1).join("").split(",").filter(Boolean);
            if (newEmojis.length > 0) {
                global.autoReactEmojis = newEmojis;
                return ctx.reply(`✅ Auto-React emojis updated to: ${global.autoReactEmojis.join(" ")}`);
            }
        }

        if (action !== "on" && action !== "off") {
            return ctx.reply(
                `🎭 *Auto-React Status* is currently: *${global.autoReactStatus ? "ON" : "OFF"}*\n\n` +
                `*Current Emojis:* ${global.autoReactEmojis.join(" ")}\n\n` +
                `Usage:\n• \`.autoreactstatus on\`\n• \`.autoreactstatus off\`\n• \`.autoreactstatus set ❤️,🔥,😍\``
            );
        }
        
        global.autoReactStatus = (action === "on");
        
        await ctx.reply(`✅ Auto-React Status is now *${global.autoReactStatus ? "ENABLED" : "DISABLED"}*`);
    }
};