const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "play",
    category: "download",
    aliases: ["song", "music", "ytmp3"],
    description: "Download a song from YouTube",
    async execute(conn, msg, args, ctx) {
        // Clean up search query
        if (args[0] && (args[0].toLowerCase() === "play" || args[0].toLowerCase() === "song")) {
            args.shift();
        }

        if (!args.length) return ctx.reply("❌ Provide a song name. Example: `.play Yatapita`");
        
        const query = args.join(" ");
        await ctx.reply(`🔍 Searching for *${query}*...`);

        try {
            // 1. Search using XTeam API
            const searchUrl = `${config.APIs.xteam}/youtube?q=${encodeURIComponent(query)}&apikey=${config.APIKeys[config.APIs.xteam]}`;
            const searchRes = await axios.get(searchUrl);

            if (!searchRes.data || !searchRes.data.result || searchRes.data.result.length === 0) {
                return ctx.reply("❌ No results found.");
            }

            const video = searchRes.data.result[0];
            const videoUrl = video.url;
            const title = video.title;

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Downloading audio, please wait...`);

            // 2. Download MP3 using XTeam API
            const dlUrl = `${config.APIs.xteam}/ytmp3?url=${encodeURIComponent(videoUrl)}&apikey=${config.APIKeys[config.APIs.xteam]}`;
            const dlRes = await axios.get(dlUrl);

            if (!dlRes.data || !dlRes.data.result || !dlRes.data.result.url) {
                return ctx.reply("❌ Failed to get download link from API.");
            }

            const audioUrl = dlRes.data.result.url;

            // 3. Download the actual audio into a Buffer (Bypasses all IP blocks)
            const audioRes = await axios.get(audioUrl, { 
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            const audioBuffer = Buffer.from(audioRes.data);

            // 4. Send to WhatsApp
            await conn.sendMessage(ctx.from, {
                audio: audioBuffer,
                mimetype: "audio/mp4",
                fileName: `${title}.mp3`,
                caption: `🎵 *${title}*`
            }, { quoted: msg });

        } catch (error) {
            console.error("Play command error:", error.message);
            await ctx.reply("❌ An error occurred while downloading the song. The API might be down.");
        }
    }
};