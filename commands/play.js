const axios = require("axios");
const yts = require("yt-search");

module.exports = {
    name: "play",
    category: "download",
    aliases: ["song", "music", "ytmp3"],
    description: "Download a song from YouTube",
    async execute(conn, msg, args, ctx) {
        // Clean up the query
        if (args[0] && ["play", "song", "music", "ytmp3"].includes(args[0].toLowerCase())) {
            args.shift();
        }

        if (!args.length) {
            return conn.sendMessage(ctx.from, { text: "❌ Provide a song name. Example: `.play Yatapita`" }, { quoted: msg });
        }
        
        const query = args.join(" ");
        await conn.sendMessage(ctx.from, { text: `🔍 Searching for *${query}*...` }, { quoted: msg });

        try {
            // 1. Search YouTube
            const searchResults = await yts(query);
            if (!searchResults.videos || searchResults.videos.length === 0) {
                return conn.sendMessage(ctx.from, { text: "❌ No results found for that query." }, { quoted: msg });
            }

            const video = searchResults.videos[0];
            const videoUrl = video.url;
            const title = video.title;

            await conn.sendMessage(ctx.from, { text: `🎵 *Found:* ${title}\n⏳ Fetching audio, please wait...` }, { quoted: msg });

            // 2. Ask Cobalt API for the MP3 link
            let downloadUrl = null;
            try {
                const response = await axios.post("https://api.cobalt.tools/api/json", {
                    url: videoUrl,
                    isAudioOnly: true,
                    aFormat: "mp3"
                }, {
                    headers: { "Accept": "application/json", "Content-Type": "application/json" }
                });
                
                if (response.data && response.data.url) {
                    downloadUrl = response.data.url;
                }
            } catch (apiError) {
                console.error("Cobalt API Error:", apiError.message);
            }

            // Fallback to a second API if Cobalt fails
            if (!downloadUrl) {
                try {
                    const fallbackRes = await axios.get(`https://api.zenkeymon.xyz/download/ytmp3?url=${encodeURIComponent(videoUrl)}`);
                    if (fallbackRes.data?.status === true) {
                        downloadUrl = fallbackRes.data.result.download_url;
                    }
                } catch (fallbackError) {
                    console.error("Fallback API Error:", fallbackError.message);
                }
            }

            if (!downloadUrl) {
                return conn.sendMessage(ctx.from, { text: "❌ Failed to get download link. The API might be down. Try again later." }, { quoted: msg });
            }

            // 3. Download the audio into a Buffer
            await conn.sendMessage(ctx.from, { text: "📥 Downloading audio to server..." }, { quoted: msg });
            const audioRes = await axios.get(downloadUrl, { 
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 60000 
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
            await conn.sendMessage(ctx.from, { text: "❌ An error occurred while downloading the song." }, { quoted: msg });
        }
    }
};