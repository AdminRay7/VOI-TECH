const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "play",
    category: "download",
    aliases: ["song", "music"],
    description: "Download a song from YouTube",
    async execute(conn, msg, args, ctx) {
        if (!args.length) return ctx.reply("❌ Provide a song name. Example: `.play Yatapita`");
        
        const query = args.join(" ");
        await ctx.reply(`🔍 Searching for *${query}*...`);

        try {
            // Search YouTube via RapidAPI
            const searchRes = await axios.get(`https://youtube-v31.p.rapidapi.com/search?q=${encodeURIComponent(query)}&part=snippet&maxResults=1`, {
                headers: {
                    'x-rapidapi-key': config.rapidApiKey,
                    'x-rapidapi-host': config.searchApiHost
                }
            });

            if (!searchRes.data.items || searchRes.data.items.length === 0) {
                return ctx.reply("❌ No results found.");
            }

            const video = searchRes.data.items[0];
            const videoId = video.id.videoId;
            const title = video.snippet.title;
            const thumbnail = video.snippet.thumbnails.high.url;

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Downloading audio, please wait...`);

            // Download MP3 via RapidAPI
            const dlRes = await axios.get(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
                headers: {
                    'x-rapidapi-key': config.rapidApiKey,
                    'x-rapidapi-host': config.rapidApiHost
                }
            });

            if (dlRes.data.status !== "ok") {
                return ctx.reply("❌ Failed to download audio. Try another song.");
            }

            const audioUrl = dlRes.data.link;

            await conn.sendMessage(ctx.from, {
                audio: { url: audioUrl },
                mimetype: "audio/mp4",
                fileName: `${title}.mp3`,
                caption: `🎵 *${title}*`
            }, { quoted: msg });

        } catch (error) {
            console.error("Play command error:", error.message);
            await ctx.reply("❌ An error occurred while downloading the song.");
        }
    }
};