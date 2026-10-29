const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "play",
    category: "media",
    aliases: ["song", "audio", "ytmp3"],
    description: "Download audio from YouTube using Toosii API",

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply(`Please provide a song name.\nExample: *${ctx.prefix}play Faded*`);
        }

        const query = args.join(" ");
        const apiKey = config.toosiiApiKey;

        if (!apiKey) {
            return ctx.reply("❌ TOOSII_API_KEY is missing in .env");
        }

        try {
            await conn.sendMessage(ctx.from, { react: { text: "⏳", key: msg.key } });
            await ctx.reply(`🔎 *Searching for:* ${query}...`);

            // 1. Search for the song on Toosii API
            const searchRes = await axios.get(`https://api.toosii.tech/search/yt?q=${encodeURIComponent(query)}&apikey=${apiKey}`);
            
            if (!searchRes.data || !searchRes.data.status || !searchRes.data.result || searchRes.data.result.length === 0) {
                await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
                return ctx.reply(`⚠️ *Toosii API Response:*\n\`\`\`${JSON.stringify(searchRes.data, null, 2)}\`\`\``);
            }

            const video = searchRes.data.result[0];
            const videoUrl = video.url;
            const title = video.title;

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Downloading audio, please wait...`);

            // 2. Download the audio using Toosii API
            const downloadRes = await axios.get(`https://api.toosii.tech/download/ytmp3?url=${encodeURIComponent(videoUrl)}&apikey=${apiKey}`);

            if (!downloadRes.data || !downloadRes.data.status || !downloadRes.data.result || !downloadRes.data.result.download_url) {
                await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
                return ctx.reply(`⚠️ *Toosii API Error:*\n\`\`\`${JSON.stringify(downloadRes.data, null, 2)}\`\`\``);
            }

            const audioUrl = downloadRes.data.result.download_url;

            // 3. Send the audio to WhatsApp
            await conn.sendMessage(ctx.from, {
                audio: { url: audioUrl },
                mimetype: 'audio/mp4',
                fileName: `${title}.mp3`
            }, { quoted: msg });

            await conn.sendMessage(ctx.from, { react: { text: "✅", key: msg.key } });

        } catch (error) {
            await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
            
            if (error.response && error.response.data) {
                const apiError = typeof error.response.data === 'string' 
                    ? error.response.data 
                    : JSON.stringify(error.response.data, null, 2);
                return ctx.reply(`⚠️ *Toosii API Error:*\n\`\`\`${apiError.substring(0, 500)}\`\`\``);
            }
            
            return ctx.reply(`⚠️ *System Error:*\n\`\`\`${error.message}\`\`\``);
        }
    }
};