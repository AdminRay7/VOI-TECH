const axios = require("axios");

module.exports = {
    name: "fact",
    category: "tools",
    aliases: ["randomfact"],
    description: "Get a random interesting fact",
    async execute(conn, msg, args, ctx) {
        try {
            const res = await axios.get("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
            await conn.sendMessage(ctx.from, { 
                text: `💡 *Did you know?*\n\n${res.data.text}` 
            }, { quoted: msg });
        } catch (e) {
            await ctx.reply("❌ Failed to get a fact.");
        }
    }
};