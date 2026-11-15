// commands/sticker.js
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { fancy } = require('../lib/font');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

module.exports = {
    name: 'sticker',
    category: 'general',
    aliases: ['s', 'stiker'],
    description: 'Convert image/video to sticker',
    
    async execute(conn, msg, args, ctx) {
        const { from, prefix } = ctx;

        // 1. Identify the target message (either the current message or the quoted one)
        const isImage = msg.message?.imageMessage;
        const isVideo = msg.message?.videoMessage;
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        const quotedIsImage = quotedMsg?.imageMessage;
        const quotedIsVideo = quotedMsg?.videoMessage;

        // Get the exact message content to download
        let messageType = null;
        let messageContent = null;

        if (isImage) {
            messageType = 'image';
            messageContent = msg.message.imageMessage;
        } else if (isVideo) {
            messageType = 'video';
            messageContent = msg.message.videoMessage;
        } else if (quotedIsImage) {
            messageType = 'image';
            messageContent = quotedMsg.imageMessage;
        } else if (quotedIsVideo) {
            messageType = 'video';
            messageContent = quotedMsg.videoMessage;
        }

        if (!messageType) {
            return conn.sendMessage(from, { 
                text: fancy(`❌ Reply to an image or a short video, or send one with the caption *${prefix}sticker*`) 
            }, { quoted: msg });
        }

        // 2. Notify user
        await conn.sendMessage(from, { react: { text: '⏳', key: msg.key } });

        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const fileName = crypto.randomBytes(8).toString('hex');
        const inputPath = path.join(tempDir, `${fileName}_input`);
        const outputPath = path.join(tempDir, `${fileName}.webp`);

        try {
            // 3. Download the media
            const stream = await downloadContentFromMessage(messageContent, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            // Size check (Max 10MB for source media)
            if (buffer.length > 10 * 1024 * 1024) {
                throw new Error("Media too large. Max 10MB.");
            }

            fs.writeFileSync(inputPath, buffer);

            // 4. Convert to WebP using FFmpeg (best for both images and videos)
            // -vf scale: Resize to 512x512 (WhatsApp limit) keeping aspect ratio
            // -r 10: 10 frames per second for video
            // -t 00:00:05: Max 5 seconds for video
            // -loop 0: Loop the sticker
            const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -r 10 -t 00:00:05 -loop 0 -preset default -an -vsync 0 -s 512x512 "${outputPath}"`;

            await new Promise((resolve, reject) => {
                exec(ffmpegCmd, (error, stdout, stderr) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            // 5. Send the sticker
            if (fs.existsSync(outputPath)) {
                const stickerBuffer = fs.readFileSync(outputPath);
                
                await conn.sendMessage(from, { 
                    sticker: stickerBuffer 
                }, { quoted: msg });
                
                await conn.sendMessage(from, { react: { text: '✅', key: msg.key } });
            } else {
                throw new Error("Conversion failed");
            }

        } catch (e) {
            console.error('[sticker] Error:', e.message);
            await conn.sendMessage(from, { 
                text: fancy(`❌ Failed to create sticker.\n_Reason: ${e.message}_`) 
            }, { quoted: msg });
            await conn.sendMessage(from, { react: { text: '❌', key: msg.key } });
        } finally {
            // 6. Cleanup temp files
            try {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch (e) {}
        }
    }
};
