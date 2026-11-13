// commands/antidelete.js
// Anti-delete — recovers deleted messages and replies to the exact chat.
// Toggle: .antidelete on | off | (no args = show state)

const autoToggles = require('../lib/autoToggles');
const messageStore = require('../lib/messageStore');
const { fancy } = require('../lib/font');
const config = require('../config');

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

module.exports = {
    name: 'antidelete',
    category: 'auto',
    aliases: ['ad'],
    description: 'Toggle anti-delete (recovers to the same chat)',
    toggleKey: 'antidelete',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId } = ctx;

        if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        if (isGroup) {
            if (!(await isBotGroupAdmin(conn, from))) {
                return conn.sendMessage(from, { text: fancy('❌ I must be a group admin to use this in a group.') }, { quoted: msg });
            }
        }

        const action = (args[0] || '').toLowerCase();

        if (action === '') {
            const on = await autoToggles.get(userId, 'antidelete', null, config.antidelete === true);
            return conn.sendMessage(from, {
                text: fancy(`🗑️ Anti-Delete\n\nStatus: ${on ? '✅ ON' : '❌ OFF'}\nRecoveries are sent to the current chat.`)
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, { text: fancy(`Usage: ${config.prefix}antidelete on|off`) }, { quoted: msg });
        }

        const value = action === 'on';
        await autoToggles.set(userId, 'antidelete', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Anti-Delete ${value ? 'ENABLED' : 'DISABLED'}.\nRecoveries will be sent to the chat.`)
        }, { quoted: msg });
    },

    async onMessage(conn, msg, ctx) {
        const { from, isGroup, userId } = ctx;

        const protocol = msg.message?.protocolMessage;
        if (!protocol) return false;
        if (protocol.type !== 0) return false; // 0 = REVOKE

        const targetId = protocol.key?.id;
        if (!targetId) return false;

        const cached = messageStore.get(targetId);
        if (!cached) return false;

        // Don't recover statuses here (presenter.js handles statuses)
        if (from === 'status@broadcast') return false;

        const prefix = ctx.prefix || '.';
        if (cached.body && cached.body.startsWith(prefix)) return false;

        const senderJid = protocol.key?.participant || protocol.participant || cached.sender || protocol.key?.remoteJid;
        const senderBare = bareNum(senderJid);
        const senderName = cached.pushname || "Unknown";
        
        // Where to reply — same chat the delete happened in
        const targetChat = from;

        try {
            const msgData = cached.message || {};
            const textBody =
                msgData.conversation ||
                msgData.extendedTextMessage?.text ||
                msgData.imageMessage?.caption ||
                msgData.videoMessage?.caption ||
                msgData.documentMessage?.caption || '';

            const prefixText = `🗑️ *Anti-Delete Alert*\n\n👤 *Sender:* ${senderName} (+${senderBare})\n\n📝 *Deleted Message:*\n`;

            if (cached.mediaBuffer && cached.mediaKind) {
                const buf = cached.mediaBuffer;
                const mime = cached.mediaMime || 'application/octet-stream';
                const caption = textBody ? `${prefixText}${textBody}` : prefixText.trim();

                let content;
                switch (cached.mediaKind) {
                    case 'image': content = { image: buf, mimetype: mime, caption, mentions: [senderJid] }; break;
                    case 'video': content = { video: buf, mimetype: mime, caption, mentions: [senderJid] }; break;
                    case 'audio':
                        content = { audio: buf, mimetype: mime, ptt: cached.ptt === true };
                        await conn.sendMessage(targetChat, { text: prefixText, mentions: [senderJid] });
                        break;
                    case 'sticker':
                        content = { sticker: buf };
                        await conn.sendMessage(targetChat, { text: prefixText, mentions: [senderJid] });
                        break;
                    case 'document': content = { document: buf, mimetype: mime, fileName: cached.fileName || 'file', caption, mentions: [senderJid] }; break;
                    default: content = { text: caption, mentions: [senderJid] };
                }
                await conn.sendMessage(targetChat, content);
                return true;
            }

            if (textBody) {
                await conn.sendMessage(targetChat, { text: `${prefixText}${textBody}`, mentions: [senderJid] });
                return true;
            }

            await conn.sendMessage(targetChat, { text: `${prefixText}*(Media or unsupported message could not be recovered)*`, mentions: [senderJid] });
            return true;

        } catch (e) {
            console.error('[antidelete] recover failed:', e.message);
            return false;
        }
    }
};