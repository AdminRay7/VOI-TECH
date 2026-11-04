const ytdl = require("ytdl-core");
const yts = require("yt-search"); // Using yt-search for reliable searching

module.exports = {
    name: "play",
    category: "download",
    aliases: ["song", "music", "ytmp3"],
    description: "Download a song directly from YouTube",
    async execute(conn, msg, args, ctx) {
        if (args[0] && (args[0].toLowerCase() === "play" || args[0].toLowerCase() === "song")) {
            args.shift();
        }

        if (!args.length) return ctx.reply("❌ Provide a song name. Example: `.play Yatapita`");
        
        const query = args.join(" ");
        await ctx.reply(`🔍 Searching for *${query}*...`);

        try {
            // 1. Search YouTube directly
            const searchResults = await yts(query);
            if (!searchResults.videos.length) {
                return ctx.reply("❌ No results found.");
            }

            const video = searchResults.videos[0];
            const videoUrl = video.url;
            const title = video.title;

            await ctx.reply(`🎵 *Found:* ${title}\n⏳ Downloading audio directly, please wait...`);

            // 2. Download audio directly to a buffer (No APIs, no blocks)
            const stream = ytdl(videoUrl, { filter: "audioonly", quality: "highestaudio" });
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const audioBuffer = Buffer.concat(chunks);

            // 3. Send the audio file
            await conn.sendMessage(ctx.from, {
                audio: audioBuffer,
                mimetype: "audio/mp4",
                fileName: `${title}.mp3`,
                caption: `🎵 *${title}*`
            }, { quoted: msg });

        } catch (error) {
            console.error("Play command error:", error.message);
            await ctx.reply("❌ An error occurred while downloading the song. YouTube may be blocking the server IP. Try again later.");
        }
    }
};