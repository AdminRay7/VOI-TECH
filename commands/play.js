const axios = require("axios");
const config = require("../config");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
            // 1. Search YouTube
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

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Fetching audio, please wait...`);

            // 2. Get Audio Link via RapidAPI
            let audioUrl = null;
            let attempts = 0;
            const maxAttempts = 10;

            while (attempts < maxAttempts) {
                const dlRes = await axios.get(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
                    headers: {
                        'x-rapidapi-key': config.rapidApiKey,
                        'x-rapidapi-host': config.rapidApiHost
                    }
                });

                const status = dlRes.data.status;

                if (status === "ok") {
                    audioUrl = dlRes.data.link;
                    break; 
                } else if (status === "processing") {
                    await sleep(1000);
                    attempts++;
                } else {
                    return ctx.reply(`❌ Failed to convert song. Status: ${status}`);
                }
            }

            if (!audioUrl) {
                return ctx.reply("❌ Timed out while converting the song. Try again later.");
            }

            // 3. DOWNLOAD THE AUDIO TO BUFFER (Bypasses RapidAPI IP Block)
            const audioRes = await axios.get(audioUrl, { 
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const audioBuffer = Buffer.from(audioRes.data);

            // 4. Send the buffer to WhatsApp
            await conn.sendMessage(ctx.from, {
                audio: audioBuffer,
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