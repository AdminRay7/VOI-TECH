const axios = require("axios");

module.exports = {
    name: "play",
    category: "download",
    aliases: ["song", "music"],
    description: "Download a song from YouTube (Bypass)",
    async execute(conn, msg, args, ctx) {
        if (!args.length) return ctx.reply("❌ Provide a song name.");
        const query = args.join(" ");
        await ctx.reply(`🔍 Searching...`);

        try {
            // 1. Search using a free API
            const search = await axios.get(`https://api.zenkeymon.xyz/search?q=${encodeURIComponent(query)}`);
            const video = search.data.result[0]; 
            
            await ctx.reply(`🎵 Found: *${video.title}*\n⏳ Downloading...`);

            // 2. Download using Cobalt (Free, bypasses Heroku block)
            const cobalt = await axios.post("https://api.cobalt.tools/", {
                url: video.url,
                downloadMode: "audio",
                audioFormat: "mp3"
            }, { headers: { "Accept": "application/json", "Content-Type": "application/json" } });

            const audioRes = await axios.get(cobalt.data.url, { responseType: "arraybuffer" });
            
            await conn.sendMessage(ctx.from, {
                audio: Buffer.from(audioRes.data),
                mimetype: "audio/mp4",
                fileName: `${video.title}.mp3`
            }, { quoted: msg });

        } catch (error) {
            console.error(error);
            await ctx.reply("❌ Failed. The API might be down.");
        }
    }
};