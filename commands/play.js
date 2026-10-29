const axios = require("axios");

// HARDCODED TOOSII API KEY
const TOOSII_API_KEY = "TSK_109_d0945231743c61dfd9036a32b70e558378e82424c049a927";

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
            let title = query;

            // Check if user provided a URL or a search term
            const urlRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/gi;
            const match = query.match(urlRegex);
            
            if (match) {
                videoUrl = `https://www.youtube.com/watch?v=${match[1]}`;
            } else {
                // Use a reliable search to get the video ID
                const searchRes = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
                const searchMatch = searchRes.data.match(/"videoId":"([^"]+)"/);
                if (searchMatch && searchMatch[1]) {
                    videoUrl = `https://www.youtube.com/watch?v=${searchMatch[1]}`;
                } else {
                    throw new Error("Could not find that song on YouTube.");
                }
            }

            await ctx.reply(`⬇️ *Downloading audio...*`);

            let audioUrl = null;

            // --- ATTEMPT 1: TOOSII API ---
            try {
                const toosiiRes = await axios.get(`https://toosiitechdevelopertools.zone.id/api/v1/ytmp3`, {
                    params: { url: videoUrl },
                    headers: {
                        'Authorization': `Bearer ${TOOSII_API_KEY}`,
                        'x-api-key': TOOSII_API_KEY
                    },
                    timeout: 15000 // 15 seconds timeout
                });

                // Try to extract the download link from common API response structures
                if (toosiiRes.data) {
                    audioUrl = toosiiRes.data.url || 
                               toosiiRes.data.link || 
                               toosiiRes.data.download_url || 
                               toosiiRes.data.result?.url || 
                               toosiiRes.data.data?.url;
                               
                    if (toosiiRes.data.title) title = toosiiRes.data.title;
                }
            } catch (toosiiError) {
                console.log("Toosii API failed, falling back...", toosiiError.message);
            }

            // --- ATTEMPT 2: FALLBACK API (If Toosii fails) ---
            if (!audioUrl) {
                console.log("Using fallback API...");
                const fallbackRes = await axios.get(`https://api.zenkey.my.id/download/ytmp3?url=${encodeURIComponent(videoUrl)}`);
                
                if (fallbackRes.data && fallbackRes.data.status) {
                    audioUrl = fallbackRes.data.result.link;
                    if (fallbackRes.data.result.title) title = fallbackRes.data.result.title;
                } else {
                    throw new Error("Both Toosii API and Fallback API failed to return a link.");
                }
            }

            // --- SEND THE AUDIO ---
            if (audioUrl) {
                await conn.sendMessage(ctx.from, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    fileName: `${title}.mp3`
                }, { quoted: msg });

                await conn.sendMessage(ctx.from, { react: { text: "✅", key: msg.key } });
            }

        } catch (error) {
            await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
            await ctx.reply(`⚠️ *Error:*\n\`\`\`${error.message}\`\`\``);
        }
    }
};