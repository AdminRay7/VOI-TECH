const axios = require("axios");
const config = require("../config");

// Helper function to wait and retry
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

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Converting to MP3, please wait...`);

            // 2. Download MP3 (WITH RETRY LOGIC)
            let audioUrl = null;
            let attempts = 0;
            const maxAttempts = 10; // Try 10 times (10 seconds max)

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
                    break; // Success! Exit the loop
                } else if (status === "processing") {
                    // Still converting, wait 1 second and try again
                    await sleep(1000);
                    attempts++;
                } else {
                    // Failed conversion
                    return ctx.reply(`❌ Failed to convert song. Status: ${status}`);
                }
            }

            if (!audioUrl) {
                return ctx.reply("❌ Timed out while converting the song. Try again later.");
            }

            // 3. Send the Audio
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