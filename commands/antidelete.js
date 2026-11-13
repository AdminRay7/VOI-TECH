// commands/antidelete.js
// Anti-delete — recovers deleted messages and sends them to the Owner's DM.

const autoToggles = require('../lib/autoToggles');
const messageStore = require('../lib/messageStore');
const { fancy } = require('../lib/font');
const config = require('../config');

// ---------------- helpers ----------------
function bareNum(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function isBotGroupAdmin(conn, groupJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        const botBare = bareNum(conn.user?.id);
        const botLidBare = bareNum(conn.user?.lid);
        const me = meta.participants.find(p => {
            const pidBare = bareNum(p.id);
            return pidBare === botBare || (botLidBare && pidBare === botLidBare);
        });
        if (!me) return false;
        return me.admin === 'admin' || me.admin === 'superadmin';
    } catch { return false; }
}

// ---------------- command ----------------
module.exports = {
    name: 'antidelete',
    category: 'auto',
    aliases: ['ad'],
    description: 'Toggle anti-delete (sends recoveries to Owner DM)',
    toggleKey: 'antidelete',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        if (isGroup) {
            if (!(await isBotGroupAdmin(conn, from))) {
                return conn.sendMessage(from, {
                    text: fancy('❌ I must be a group admin to use this in a group.')
                }, { quoted: msg });
            }
        }

        const action = (args[0] || '').toLowerCase();

        // ---- show state ----
        if (action === '') {
            const on = await autoToggles.get(userId, 'antidelete', null, config.antidelete === true);
            return conn.sendMessage(from, {
                text: fancy(
                    `🗑️ Anti-Delete (session-wide)\n\n` +
                    `Status: ${on ? '✅ ON' : '❌ OFF'}\n` +
                    `Recoveries are sent privately to your DM.`
                )
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, {
                text: fancy(`Usage: ${config.prefix}antidelete on|off`)
            }, { quoted: msg });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'antidelete', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Anti-Delete ${value ? 'ENABLED' : 'DISABLED'}.\nRecoveries will be sent to your DM.`)
        }, { quoted: msg });
    },

    // ============================================================
    //   ENFORCEMENT — fires on every message when toggle ON
    // ============================================================
    async onMessage(conn, msg, ctx) {
        const { from, isGroup, userId } = ctx;

        // detect REVOKE
        const protocol = msg.message?.protocolMessage;
        if (!protocol) return false;
        if (protocol.type !== 0) return false;   // 0 = REVOKE

        const targetId = protocol.key?.id;
        if (!targetId) return false;

        const cached = messageStore.get(targetId);
        if (!cached) return false;

        // Ignore if the deleted message was a command
        const prefix = ctx.prefix || '.';
        if (cached.body && cached.body.startsWith(prefix)) return false;

        // Get sender info
        const senderJid = protocol.key?.participant || protocol.participant || cached.sender || protocol.key?.remoteJid;
        const senderBare = bareNum(senderJid);
        const senderName = cached.pushname || "Unknown";
        
        // Get Location Name
        let locationName = "Unknown Chat";
        if (isGroup) {
            try {
                const meta = await conn.groupMetadata(from);
                locationName = meta.subject || `Group (${from.split('@')[0]})`;
            } catch {
                locationName = `Group (${from.split('@')[0]})`;
            }
        } else {
            // In DM, try to get the contact's pushname
            locationName = senderName !== "Unknown" ? senderName : `DM (+${senderBare})`;
        }

        // ---- Send recovery to the BOT'S DM (Owner's DM) ----
        const botJid = conn.user?.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';

        try {
            const msgData = cached.message || {};
            const textBody =
                msgData.conversation ||
                msgData.extendedTextMessage?.text ||
                msgData.imageMessage?.caption ||
                msgData.videoMessage?.caption ||
                msgData.documentMessage?.caption || '';

            // Build the exact format you requested
            const prefixText = `🗑️ *Anti-Delete Alert*\n\n` +
                               `📍 *Location:* ${isGroup ? 'Group' : 'DM'} - ${locationName}\n` +
                               `👤 *Sender:* ${senderName} (+${senderBare})\n\n` +
                               `📝 *Deleted Message:*\n`;

            // ---- MEDIA ----
            if (cached.mediaBuffer && cached.mediaKind) {
                const buf = cached.mediaBuffer;
                const mime = cached.mediaMime || 'application/octet-stream';
                const caption = textBody ? `${prefixText}${textBody}` : prefixText.trim();

                let content;
                switch (cached.mediaKind) {
                    case 'image':
                        content = { image: buf, mimetype: mime, caption };
                        break;
                    case 'video':
                        content = { video: buf, mimetype: mime, caption };
                        break;
                    case 'audio':
                        content = { audio: buf, mimetype: mime, ptt: cached.ptt === true };
                        await conn.sendMessage(botJid, { text: prefixText });
                        break;
                    case 'sticker':
                        content = { sticker: buf };
                        await conn.sendMessage(botJid, { text: prefixText });
                        break;
                    case 'document':
                        content = { document: buf, mimetype: mime, fileName: cached.fileName || 'file', caption };
                        break;
                    default:
                        content = { text: caption };
                }
                await conn.sendMessage(botJid, content);
                return true;
            }

            // ---- TEXT ----
            if (textBody) {
                await conn.sendMessage(botJid, {
                    text: `${prefixText}${textBody}`
                });
                return true;
            }

            // ---- FALLBACK ----
            await conn.sendMessage(botJid, {
                text: `${prefixText}*(Media or unsupported message could not be recovered)*`
            });
            return true;

        } catch (e) {
            console.error('[antidelete] recover failed:', e.message);
            return false;
        }
    }
};