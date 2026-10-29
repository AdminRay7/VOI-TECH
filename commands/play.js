const axios = require("axios");

// HARDCODED TOOSII API KEY
const TOOSII_API_KEY = "TSK_109_d0945231743c61dfd9036a32b70e558378e82424c049a927";
const BASE_URL = "https://toosiitechdevelopertools.zone.id";

module.exports = {
    name: "play",
    category: "media",
    aliases: ["song", "audio", "ytmp3"],
    description: "Download audio from YouTube",

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply(`Please provide a song name.\nExample: *${ctx.prefix}play Faded*`);
        }

        const query = args.join(" ");
        
        try {
            await conn.sendMessage(ctx.from, { react: { text: "⏳", key: msg.key } });
            await ctx.reply(`🔎 *Searching for:* ${query}...`);

            let videoUrl = "";

            // Check if user typed a direct YouTube link
            const urlRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/gi;
            const match = query.match(urlRegex);
            
            if (match) {
                videoUrl = `https://www.youtube.com/watch?v=${match[1]}`;
            } else {
                // 1. SEARCH (Using the exact granted scope: /api/search/youtube)
                const searchRes = await axios.get(`${BASE_URL}/api/search/youtube`, {
                    params: { q: query, query: query }, // send both just in case
                    headers: { 'Authorization': `Bearer ${TOOSII_API_KEY}` }
                });

                // Extract video URL from the search result
                const searchData = searchRes.data;
                if (searchData && searchData.success && searchData.data && searchData.data.length > 0) {
                    videoUrl = searchData.data[0].url || searchData.data[0].link || searchData.data[0].videoUrl;
                } else if (searchData && searchData.result && searchData.result.length > 0) {
                    videoUrl = searchData.result[0].url || searchData.result[0].link || searchData.result[0].videoUrl;
                } else {
                    throw new Error("Toosii API could not find the song.");
                }
            }

            await ctx.reply(`⬇️ *Downloading audio...*`);

            // 2. DOWNLOAD (Using the exact granted scope: /api/download/audio)
            const downloadRes = await axios.get(`${BASE_URL}/api/download/audio`, {
                params: { url: videoUrl, query: query },
                headers: { 'Authorization': `Bearer ${TOOSII_API_KEY}` }
            });

            // Extract download link
            const downloadData = downloadRes.data;
            const audioUrl = downloadData?.url || 
                             downloadData?.link || 
                             downloadData?.download_url || 
                             downloadData?.data?.url ||
                             downloadData?.result?.url;

            const title = downloadData?.title || downloadData?.data?.title || downloadData?.result?.title || "Audio";

            if (!audioUrl) {
                throw new Error("Toosii API did not return an audio link.");
            }

            // 3. Send to WhatsApp
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
                return ctx.reply(`⚠️ *Toosii API Error:*\n\`\`\`${apiError.substring(0, 800)}\`\`\``);
            }
            
            await ctx.reply(`⚠️ *Error:*\n\`\`\`${error.message}\`\`\``);
        }
    }
};