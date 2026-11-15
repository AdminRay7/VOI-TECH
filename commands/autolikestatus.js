// commands/autolikestatus.js
const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'autolikestatus',
    category: 'auto',
    aliases: ['als', 'autolike'],
    description: 'Auto-like statuses instantly',
    toggleKey: 'statuslike',

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId, prefix } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        const action = (args[0] || '').toLowerCase();

        if (action === '') {
            const on = await autoToggles.get(userId, 'statuslike', null, false);
            return conn.sendMessage(from, {
                text: fancy(`❤️ Auto-Like Status: ${on ? '✅ ON' : '❌ OFF'}\n\nAutomatically reacts to new statuses.`)
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, {
                text: fancy(`Usage: ${prefix}autolikestatus on|off`)
            }, { quoted: msg });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'statuslike', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Auto-Like Status ${value ? 'ENABLED' : 'DISABLED'}.`)
        }, { quoted: msg });
    }

    , async onMessage(conn, msg, ctx) {
        const { isStatus, sender, senderBare, userId } = ctx;

        if (!isStatus) return false;

        const isRevoke = !!msg.message?.protocolMessage;
        if (isRevoke) return false;

        console.log(`\n[autolike-DEBUG] Detected status from ${senderBare}`);

        // 1. Check if the user has this feature enabled
        const on = await autoToggles.get(userId, 'statuslike', null, false);
        console.log(`[autolike-DEBUG] Is toggle ON in DB? ${on ? 'YES' : 'NO'}`);
        
        if (!on) return false;

        try {
            const emojis = ['❤️', '💚', '💙', '🔥', '👍', '💯', '✨'];
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];

            console.log(`[autolike-DEBUG] Attempting to send reaction ${emoji}...`);

            await conn.sendMessage(
                'status@broadcast',
                { react: { text: emoji, key: msg.key } },
                { statusJidList: [sender] }
            );
            
            console.log(`✅ [autolike-DEBUG] Successfully reacted to status!`);
        } catch (e) {
            console.error(`❌ [autolike-DEBUG] Failed to like status:`, e.message);
        }

        return false;
    }
};