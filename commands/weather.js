const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "weather",
    category: "tools",
    aliases: ["temp", "climate"],
    description: "Get current weather for a city",
    async execute(conn, msg, args, ctx) {
        if (!args.length) return ctx.reply("❌ Provide a city name. Example: `.weather Nairobi`");
        
        const city = args.join(" ");
        await ctx.reply(`🌍 Fetching weather for *${city}*...`);

        try {
            const res = await axios.get(`https://api.weatherapi.com/v1/current.json?key=${config.weatherApiKey}&q=${encodeURIComponent(city)}`);
            const data = res.data;

            const text = `🌤️ *Weather in ${data.location.name}, ${data.location.country}*\n\n` +
                         `• Condition: *${data.current.condition.text}*\n` +
                         `• Temperature: *${data.current.temp_c}°C*\n` +
                         `• Feels Like: *${data.current.feelslike_c}°C*\n` +
                         `• Humidity: *${data.current.humidity}%*\n` +
                         `• Wind: *${data.current.wind_kph} km/h*`;

            await conn.sendMessage(ctx.from, { text }, { quoted: msg });
        } catch (error) {
            await ctx.reply("❌ Could not find weather for that city.");
        }
    }
};