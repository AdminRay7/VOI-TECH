// commands/autoviewstatus.js
// Automatically views statuses immediately.

const autoToggles = require('../lib/autoToggles');
const { fancy } = require('../lib/font');
const config = require('../config');

module.exports = {
    name: 'autoviewstatus',
    category: 'auto',
    aliases: ['avs', 'autostatus'],
    description: 'Auto-view statuses instantly',
    toggleKey: 'statusview',

    async execute(conn, msg, args, ctx) {
        const { from, isOwner, userId } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        const action = (args[0] || '').toLowerCase();

        // Show status
        if (action === '') {
            const on = await autoToggles.get(userId, 'statusview', null, false);
            return conn.sendMessage(from, {
                text: fancy(`👁️ Auto-View Status: ${on ? '✅ ON' : '❌ OFF'}\n\nAutomatically views new statuses.`)
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, {
                text: fancy(`Usage: ${ctx.prefix}autoviewstatus on|off`)
            }, { quoted: msg });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'statusview', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Auto-View Status ${value ? 'ENABLED' : 'DISABLED'}.`)
        }, { quoted: msg });
    },

    async onMessage(conn, msg, ctx) {
        const { isStatus, senderBare, userId } = ctx;

        if (!isStatus) return false;

        const isRevoke = !!msg.message?.protocolMessage;
        if (isRevoke) return false; // Ignore revokes

        // 1. Check if the user has this feature enabled
        const on = await autoToggles.get(userId, 'statusview', null, false);
        if (!on) return false;

        try {
            // 2. Read the status instantly
            await conn.readMessages([msg.key]);
            
            console.log(`[autoviewstatus] Viewed status from ${senderBare}`);
        } catch (e) {
            console.error(`[autoviewstatus] Failed to view status:`, e.message);
        }

        // Return false so other handlers (like the DM forwarder) still run!
        return false;
    }
};