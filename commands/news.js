const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "news",
    category: "tools",
    aliases: ["headlines"],
    description: "Get top news headlines",
    async execute(conn, msg, args, ctx) {
        await ctx.reply("📰 Fetching latest news...");
        
        try {
            const country = args[0]?.toLowerCase() || "us";
            const res = await axios.get(`https://newsapi.org/v2/top-headlines?country=${country}&pageSize=5&apiKey=${config.newsApiKey}`);
            
            if (res.data.articles.length === 0) return ctx.reply("❌ No news found.");
            
            let text = `📰 *Top News (${country.toUpperCase()})*\n\n`;
            res.data.articles.forEach((article, index) => {
                text += `*${index + 1}. ${article.title}*\n`;
                text += `${article.description || "No description"}\n`;
                text += `🔗 ${article.url}\n\n`;
            });

            await conn.sendMessage(ctx.from, { text }, { quoted: msg });
        } catch (error) {
            await ctx.reply("❌ Failed to fetch news.");
        }
    }
};