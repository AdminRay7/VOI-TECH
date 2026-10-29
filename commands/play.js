const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "play",
    category: "media",
    aliases: ["song", "audio"],
    description: "Download audio from YouTube",
    ownerOnly: false,

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply(`Please provide a song name.\nExample: *${ctx.prefix}play Faded*`);
        }

        const query = args.join(" ");
        await ctx.reply(`🔎 *Searching for:* ${query}...`);

        try {
            // 1. Search for the video on YouTube using RapidAPI
            const searchOptions = {
                method: 'GET',
                url: `https://${config.searchApiHost}/search`,
                params: { query: query, part: 'snippet', maxResults: '1', type: 'video' },
                headers: {
                    'X-RapidAPI-Key': config.rapidApiKey,
                    'X-RapidAPI-Host': config.searchApiHost
                }
            };

            const searchRes = await axios.request(searchOptions);
            const video = searchRes.data.items[0];

            if (!video) {
                return ctx.reply("❌ No results found for that song.");
            }

            const videoId = video.id.videoId;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const title = video.snippet.title;

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Downloading audio, please wait...`);

            // 2. Download the audio using RapidAPI
            const downloadOptions = {
                method: 'GET',
                url: `https://${config.rapidApiHost}/dl`,
                params: { url: videoUrl },
                headers: {
                    'X-RapidAPI-Key': config.rapidApiKey,
                    'X-RapidAPI-Host': config.rapidApiHost
                }
            };

            const downloadRes = await axios.request(downloadOptions);
            
            // RapidAPI youtube-mp36 usually returns a link in .link
            const audioUrl = downloadRes.data.link; 

            if (!audioUrl) {
                return ctx.reply("❌ Failed to get the download link. The video might be restricted.");
            }

            // 3. Send the audio to WhatsApp
            await conn.sendMessage(ctx.from, {
                audio: { url: audioUrl },
                mimetype: 'audio/mp4',
                fileName: `${title}.mp3`
            }, { quoted: msg });

        } catch (error) {
            console.error("Play command error:", error.message);
            await ctx.reply(`❌ Error: ${error.message}`);
        }
    }
};
