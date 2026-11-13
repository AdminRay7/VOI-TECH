// commands/antidelete.js
// Anti-delete — works in BOTH DMs and groups.
// Toggle: .antidelete on | off | (no args = show state)

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
    description: 'Toggle anti-delete for DMs + all groups in this session',
    toggleKey: 'antidelete',

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, isOwner, userId } = ctx;

        if (!isOwner) {
            return conn.sendMessage(from, { text: fancy('❌ Owner only.') }, { quoted: msg });
        }

        // If inside a group, verify bot is admin
        if (isGroup) {
            if (!(await isBotGroupAdmin(conn, from))) {
                return conn.sendMessage(from, {
                    text: fancy('❌ I must be a group admin to use this in a group.')
                }, { quoted: msg });
            }
        }

        const action = (args[0] || '').toLowerCase();

        // ---- show state (session-wide) ----
        if (action === '') {
            const on = await autoToggles.get(userId, 'antidelete', null, config.antidelete === true);
            return conn.sendMessage(from, {
                text: fancy(
                    `🗑️ Anti-Delete (session-wide)\n\n` +
                    `Status: ${on ? '✅ ON' : '❌ OFF'}\n` +
                    `Applies to: DMs + all groups`
                )
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(action)) {
            return conn.sendMessage(from, {
                text: fancy(`Usage: ${config.prefix}antidelete on|off`)
            }, { quoted: msg });
        }

        const value = action === 'on';

        // Save at SESSION scope → applies to DMs (no groupJid) + every group in this session
        await autoToggles.set(userId, 'antidelete', null, value);

        return conn.sendMessage(from, {
            text: fancy(`✅ Anti-Delete ${value ? 'ENABLED' : 'DISABLED'} (DMs + all groups).`)
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

        // FIX 1: Don't recover the bot's own messages (like deleted commands)
        if (protocol.key?.fromMe === true) return false;

        const targetId = protocol.key?.id;
        if (!targetId) return false;

        const cached = messageStore.get(targetId);
        if (!cached) {
            // Silently fail if it's not in cache (e.g., deleted before bot restarted)
            return false;
        }

        const senderJid = protocol.key?.participant || protocol.participant || cached.sender;
        const senderBare = bareNum(senderJid);

        // Where to post the recovery — same chat the delete happened in
        const targetChat = from;

        // Recover
        try {
            const msgData = cached.message || {};
            const textBody =
                msgData.conversation ||
                msgData.extendedTextMessage?.text ||
                msgData.imageMessage?.caption ||
                msgData.videoMessage?.caption ||
                msgData.documentMessage?.caption || '';

            const prefixText = `🗑️ *Anti-Delete*\n\n👤 @${senderBare} deleted:\n\n`;

            // ---- MEDIA ----
            if (cached.mediaBuffer && cached.mediaKind) {
                const buf = cached.mediaBuffer;
                const mime = cached.mediaMime || 'application/octet-stream';
                const caption = textBody ? `${prefixText}${textBody}` : prefixText.trim();

                let content;
                switch (cached.mediaKind) {
                    case 'image':
                        content = { image: buf, mimetype: mime, caption, mentions: [senderJid] };
                        break;
                    case 'video':
                        content = { video: buf, mimetype: mime, caption, mentions: [senderJid] };
                        break;
                    case 'audio':
                        content = { audio: buf, mimetype: mime, ptt: cached.ptt === true };
                        // Audio messages can't have mentions or captions in WhatsApp, so we send text separately
                        await conn.sendMessage(targetChat, { text: prefixText, mentions: [senderJid] });
                        break;
                    case 'sticker':
                        content = { sticker: buf };
                        await conn.sendMessage(targetChat, { text: prefixText, mentions: [senderJid] });
                        break;
                    case 'document':
                        content = { document: buf, mimetype: mime, fileName: cached.fileName || 'file', caption, mentions: [senderJid] };
                        break;
                    default:
                        content = { text: caption, mentions: [senderJid] };
                }
                await conn.sendMessage(targetChat, content);
                return true;
            }

            // ---- TEXT ----
            if (textBody) {
                await conn.sendMessage(targetChat, {
                    text: `${prefixText}${textBody}`,
                    mentions: [senderJid]
                });
                return true;
            }

            // ---- FALLBACK ----
            await conn.sendMessage(targetChat, {
                text: fancy(`🗑️ @${senderBare} deleted a message but content isn't recoverable.`),
                mentions: [senderJid]
            });
            return true;

        } catch (e) {
            console.error('[antidelete] recover failed:', e.message);
            return false;
        }
    }
};