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

            // 1. Search using the granted search scope
            const searchRes = await axios.get(`${BASE_URL}/api/search/youtube`, {
                params: { q: query },
                headers: { 'Authorization': `Bearer ${TOOSII_API_KEY}` }
            });

            // Extract the video URL from the response
            if (searchRes.data && searchRes.data.success && searchRes.data.data && searchRes.data.data.length > 0) {
                videoUrl = searchRes.data.data[0].url;
            } else if (searchRes.data && searchRes.data.result && searchRes.data.result.length > 0) {
                videoUrl = searchRes.data.result[0].url;
            } else {
                throw new Error("Toosii API could not find the song.");
            }

            await ctx.reply(`⬇️ *Downloading audio...*`);

            // 2. Download using the granted audio scope
            const downloadRes = await axios.get(`${BASE_URL}/api/download/audio`, {
                params: { url: videoUrl },
                headers: { 'Authorization': `Bearer ${TOOSII_API_KEY}` }
            });

            // Extract the audio link from the download response
            const audioUrl = downloadRes.data?.url || 
                             downloadRes.data?.link || 
                             downloadRes.data?.download_url || 
                             downloadRes.data?.data?.url;

            const title = downloadRes.data?.title || "Audio";

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
            
            // Show the exact API error if it fails
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