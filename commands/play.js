const axios = require("axios");
const config = require("../config");

module.exports = {
    name: "play",
    category: "media",
    aliases: ["song", "audio", "ytmp3"],
    description: "Download audio from YouTube",

    async execute(conn, msg, args, ctx) {
        if (!args.length) {
            return ctx.reply(`Please provide a song name or YouTube link.`);
        }

        const query = args.join(" ");
        
        try {
            await conn.sendMessage(ctx.from, { react: { text: "⏳", key: msg.key } });

            let videoId = "";
            const urlRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/gi;
            const match = query.match(urlRegex);
            
            if (match) {
                videoId = match[1];
            } else {
                // Search YouTube for the video ID
                const searchRes = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
                const searchMatch = searchRes.data.match(/"videoId":"([^"]+)"/);
                
                if (searchMatch && searchMatch[1]) {
                    videoId = searchMatch[1];
                } else {
                    // SHOW THE RAW YOUTUBE RESPONSE INSTEAD OF A FAKE ERROR
                    await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
                    const rawYtResponse = String(searchRes.data).substring(0, 1500); // Send first 1500 chars
                    return ctx.reply(`⚠️ *YouTube Raw Response (Search Failed):*\n\n\`\`\`${rawYtResponse}\`\`\``);
                }
            }

            await ctx.reply(`⬇️ *Downloading audio...*`);

            const options = {
                method: 'GET',
                url: `https://${config.rapidApiHost}/dl`,
                params: { id: videoId },
                headers: {
                    'X-RapidAPI-Key': config.rapidApiKey,
                    'X-RapidAPI-Host': config.rapidApiHost
                }
            };

            const response = await axios.request(options);
            
            if (response.data && response.data.link) {
                const audioUrl = response.data.link;
                const title = response.data.title || "Audio";

                await conn.sendMessage(ctx.from, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    fileName: `${title}.mp3`
                }, { quoted: msg });

                await conn.sendMessage(ctx.from, { react: { text: "✅", key: msg.key } });

            } else {
                // SHOW THE EXACT RAPIDAPI RESPONSE
                await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
                const rawApiError = JSON.stringify(response.data, null, 2);
                return ctx.reply(`⚠️ *RapidAPI Response:*\n\`\`\`${rawApiError}\`\`\``);
            }

        } catch (error) {
            await conn.sendMessage(ctx.from, { react: { text: "❌", key: msg.key } });
            
            // SHOW THE EXACT ERROR FROM AXIOS / RAPIDAPI
            if (error.response && error.response.data) {
                const apiError = JSON.stringify(error.response.data, null, 2);
                return ctx.reply(`⚠️ *API Error:*\n\`\`\`${apiError}\`\`\``);
            }
            
            // SHOW THE EXACT NETWORK ERROR
            return ctx.reply(`⚠️ *Network Error:*\n\`\`\`${error.message}\`\`\``);
        }
    }
};
