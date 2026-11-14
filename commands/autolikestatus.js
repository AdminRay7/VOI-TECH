// commands/autolikestatus.js
// Automatically reacts to statuses immediately.

const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'autolikestatus',
    category: 'auto',
    aliases: ['als', 'autolike'],
    description: 'Auto-like statuses instantly',
    toggleKey: 'statuslike', // Matches the key in autoToggles FEATURES

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId, prefix } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        const action = (args[0] || '').toLowerCase();

        // Show status
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
    },

    async onMessage(conn, msg, ctx) {
        const { isStatus, sender, senderBare, userId } = ctx;

        if (!isStatus) return false;

        const isRevoke = !!msg.message?.protocolMessage;
        if (isRevoke) return false; // Ignore deleted statuses

        // 1. Check if the user has this feature enabled
        const on = await autoToggles.get(userId, 'statuslike', null, false);
        if (!on) return false;

        try {
            // 2. Send a random emoji reaction to the status
            const emojis = ['❤️', '💚', '💙', '🔥', '👍', '💯', '✨'];
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];

            // FIX: Send reaction directly to the sender's status
            await conn.sendMessage(
                'status@broadcast',
                { react: { text: emoji, key: msg.key } },
                { statusJidList: [sender] }
            );
            
            console.log(`[autolikestatus] Reacted ${emoji} to status from ${senderBare}`);
        } catch (e) {
            console.error(`[autolikestatus] Failed to like status:`, e.message);
        }

        // Return false so the DM forwarder still runs
        return false;
    }
};