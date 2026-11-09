module.exports = {
    name: "autoread",
    category: "settings",
    aliases: ["autochatread", "readchat"],
    description: "Toggle auto-read for incoming chats (on/off)",

    async execute(conn, msg, args, ctx) {
        // Initialize global state if it doesn't exist yet
        if (global.autoReadChat === undefined) global.autoReadChat = true; 

        const action = args[0]?.toLowerCase();

        if (action !== "on" && action !== "off") {
            return ctx.reply(
                `📖 *Auto-Read Chats* is currently: *${global.autoReadChat ? "ON" : "OFF"}*\n\n` +
                `Usage:\n• \`.autoread on\`\n• \`.autoread off\``
            );
        }
        
        global.autoReadChat = (action === "on");
        
        await ctx.reply(`✅ Auto-Read Chats is now *${global.autoReadChat ? "ENABLED" : "DISABLED"}*`);
    }
};