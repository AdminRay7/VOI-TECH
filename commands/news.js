// commands/news.js
const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "news",
    category: "tools",
    aliases: ["headlines"],
    description: "Get top news headlines",
    async execute(conn, msg, args, ctx) {
        const { from } = ctx;

        // Send initial loading message
        const loading = await conn.sendMessage(from, { text: "📰 Fetching latest news..." }, { quoted: msg });

        try {
            const country = args[0]?.toLowerCase() || "us";
            
            // Ensure country is a 2-letter code (WhatsApp News API requirement)
            if (country.length !== 2) {
                return conn.sendMessage(from, { text: "❌ Invalid country code. Use 2 letters (e.g., .news ke, .news us)", edit: loading.key });
            }

            const res = await axios.get(`https://newsapi.org/v2/top-headlines?country=${country}&pageSize=5&apiKey=${config.newsApiKey}`);

            if (!res.data.articles || res.data.articles.length === 0) {
                return conn.sendMessage(from, { text: "❌ No news found for this country.", edit: loading.key });
            }

            let text = `📰 *Top News (${country.toUpperCase()})*\n\n`;
            res.data.articles.forEach((article, index) => {
                text += `*${index + 1}. ${article.title}*\n`;
                text += `${article.description || "No description"}\n`;
                text += `🔗 ${article.url}\n\n`;
            });

            // Edit the loading message with the final news
            await conn.sendMessage(from, { text, edit: loading.key });

        } catch (error) {
            console.error("News Error:", error.message);
            // If error, edit the loading message to show failure
            await conn.sendMessage(from, { text: "❌ Failed to fetch news. Check your API key or try again later.", edit: loading.key });
        }
    }
};