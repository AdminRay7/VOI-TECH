module.exports = {
    name: "autoreact",
    category: "settings",
    aliases: ["autochatreact", "reactchat"],
    description: "Toggle auto-react for incoming chats (on/off)",

    async execute(conn, msg, args, ctx) {
        // Initialize global states if they don't exist yet
        if (global.autoReactChat === undefined) global.autoReactChat = false;
        if (!global.autoReactChatEmojis) global.autoReactChatEmojis = ["✅", "👍", "💯", "🔥"];

        const action = args[0]?.toLowerCase();
        
        if (action === "set" && args.length > 1) {
            // Allow user to set custom emojis: .autoreact set ✅,👍,🔥
            const newEmojis = args.slice(1).join("").split(",").filter(Boolean);
            if (newEmojis.length > 0) {
                global.autoReactChatEmojis = newEmojis;
                return ctx.reply(`✅ Chat Auto-React emojis updated to: ${global.autoReactChatEmojis.join(" ")}`);
            }
        }

        if (action !== "on" && action !== "off") {
            return ctx.reply(
                `💬 *Auto-React Chat* is currently: *${global.autoReactChat ? "ON" : "OFF"}*\n\n` +
                `*Current Emojis:* ${global.autoReactChatEmojis.join(" ")}\n\n` +
                `Usage:\n• \`.autoreact on\`\n• \`.autoreact off\`\n• \`.autoreact set ✅,👍,🔥\``
            );
        }
        
        global.autoReactChat = (action === "on");
        
        await ctx.reply(`✅ Auto-React Chat is now *${global.autoReactChat ? "ENABLED" : "DISABLED"}*`);
    }
};