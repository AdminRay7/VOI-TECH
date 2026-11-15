// commands/add.js
const { fancy } = require('../lib/font');

function bareNum(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

const metaCache = new Map();
const META_TTL_MS = 60_000;

async function getGroupMeta(conn, groupJid) {
    const hit = metaCache.get(groupJid);
    if (hit && Date.now() - hit.ts < META_TTL_MS) return hit.meta;
    try {
        const meta = await conn.groupMetadata(groupJid);
        metaCache.set(groupJid, { meta, ts: Date.now() });
        return meta;
    } catch (e) {
        metaCache.set(groupJid, { meta: null, ts: Date.now() });
        return null;
    }
}

function participantIsAdmin(meta, sender) {
    if (!meta || !Array.isArray(meta.participants)) return false;
    const sb = bareNum(sender);
    return meta.participants.some(p =>
        bareNum(p.id) === sb && (p.admin === 'admin' || p.admin === 'superadmin')
    );
}

function botIsAdmin(meta, conn) {
    if (!meta || !Array.isArray(meta.participants)) return false;
    const botBare = bareNum(conn.user?.id);
    const botLid = bareNum(conn.user?.lid);
    const me = meta.participants.find(p => {
        const pb = bareNum(p.id);
        return pb === botBare || (botLid && pb === botLid);
    });
    return me && (me.admin === 'admin' || me.admin === 'superadmin');
}

module.exports = {
    name: "add",
    category: "group",
    aliases: ["invite"],
    description: "Add a member to the group",
    
    async execute(conn, msg, args, ctx) {
        const { from, sender, isGroup, isOwner, prefix } = ctx;

        // 1. Group Check
        if (!isGroup) {
            return conn.sendMessage(from, { 
                text: fancy("❌ This command is only for groups.") 
            }, { quoted: msg });
        }

        // 2. Fetch Group Meta
        const meta = await getGroupMeta(conn, from);
        if (!meta) {
            return conn.sendMessage(from, { 
                text: fancy("❌ Could not fetch group info. Try again.") 
            }, { quoted: msg });
        }

        // 3. Admin Check
        const isAdmin = participantIsAdmin(meta, sender);
        if (!isAdmin && !isOwner) {
            return conn.sendMessage(from, { 
                text: fancy("❌ You must be an admin to use this.") 
            }, { quoted: msg });
        }

        // 4. Bot Admin Check (Needed to add users)
        if (!botIsAdmin(meta, conn)) {
            return conn.sendMessage(from, { 
                text: fancy("❌ I must be a group admin to add users.") 
            }, { quoted: msg });
        }

        // 5. Validate Number
        const num = args[0]?.replace(/\D/g, "");
        if (!num || num.length < 10 || num.length > 15) {
            return conn.sendMessage(from, { 
                text: fancy(`❌ Provide a valid phone number.\n\nExample: ${prefix}add 254712345678`) 
            }, { quoted: msg });
        }

        // 6. Add User
        try {
            const res = await conn.groupParticipantsUpdate(from, [`${num}@s.whatsapp.net`], "add");
            const status = res[0]?.status;

            if (status === "403") {
                return conn.sendMessage(from, { text: fancy("❌ User has privacy settings preventing them from being added.") }, { quoted: msg });
            }
            if (status === "408") {
                return conn.sendMessage(from, { text: fancy("❌ User recently left the group.") }, { quoted: msg });
            }
            if (status === "409") {
                return conn.sendMessage(from, { text: fancy("❌ User is already in the group.") }, { quoted: msg });
            }

            // Success
            await conn.sendMessage(from, { 
                text: fancy(`✅ Added @${num}`), 
                mentions: [`${num}@s.whatsapp.net`] 
            }, { quoted: msg });

            // Clear cache so the group updates immediately
            metaCache.delete(from);

        } catch (e) {
            console.error("[add] Error:", e.message);
            await conn.sendMessage(from, { 
                text: fancy("❌ Failed to add user. They may have blocked the bot.") 
            }, { quoted: msg });
        }
    }
};