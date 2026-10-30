const axios = require("axios");

module.exports = {
    name: "joke",
    category: "general",
    aliases: ["funny"],
    description: "Get a random joke",
    async execute(conn, msg, args, ctx) {
        try {
            const res = await axios.get("https://official-joke-api.appspot.com/random_joke");
            const joke = `${res.data.setup}\n\n*${res.data.punchline}* 😂`;
            await conn.sendMessage(ctx.from, { text: joke }, { quoted: msg });
        } catch (e) {
            await ctx.reply("❌ Failed to fetch a joke.");
        }
    }
};
