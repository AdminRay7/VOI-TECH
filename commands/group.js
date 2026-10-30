module.exports = {
    name: "group",
    category: "admin",
    aliases: ["g", "gc"],
    description: "Group management commands (kick, add, promote, demote, mute, etc.)",
    ownerOnly: false,

    async execute(conn, msg, args, ctx) {
        const { from, isGroup, sender, isOwner, reply } = ctx;

        if (!isGroup) return reply("❌ This command can only be used in groups.");

        const groupMetadata = await conn.groupMetadata(from);
        const participants = groupMetadata.participants;
        const userParticipant = participants.find(p => p.id === sender);
        const isAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin';

        if (!isAdmin && !isOwner) {
            return reply("❌ You must be a group admin to use this command.");
        }

        const botId = conn.user.id.split(':')[0] + '@s.whatsapp.net';
        const botParticipant = participants.find(p => p.id === botId);
        const botIsAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

        if (!botIsAdmin) {
            return reply("❌ I need to be an admin to perform this action.");
        }

        const action = args[0]?.toLowerCase();
        if (!action) {
            return reply(`⚙️ *Group Commands Usage:*\n\n` +
                `• \`.group kick @user\`\n` +
                `• \`.group add 2547...\`\n` +
                `• \`.group promote @user\`\n` +
                `• \`.group demote @user\`\n` +
                `• \`.group mute\`\n` +
                `• \`.group unmute\`\n` +
                `• \`.group link\`\n` +
                `• \`.group revoke\`\n` +
                `• \`.group subject New Name\``);
        }

        try {
            // DETECTION HELPER: Gets mentioned user OR quoted user
            const getTarget = () => {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const quotedUser = msg.message.extendedTextMessage?.contextInfo?.participant;
                return mentioned[0] || quotedUser;
            };

            // ==========================================
            // KICK
            // ==========================================
            if (action === "kick") {
                const target = getTarget();
                if (!target) return reply("❌ Tag or reply to the user you want to kick.");
                
                await conn.groupParticipantsUpdate(from, [target], "remove");
                return conn.sendMessage(from, { 
                    text: `✅ Successfully kicked @${target.split('@')[0]}.`, 
                    mentions: [target] 
                }, { quoted: msg });
            }

            // ==========================================
            // ADD
            // ==========================================
            if (action === "add") {
                const num = args[1]?.replace(/\D/g, "");
                if (!num) return reply("❌ Provide a phone number. Example: `.group add 254712345678`");
                
                const jid = `${num}@s.whatsapp.net`;
                const res = await conn.groupParticipantsUpdate(from, [jid], "add");
                
                if (res[0].status === "403") return reply("❌ User has privacy settings preventing them from being added.");
                if (res[0].status === "408") return reply("❌ User recently left the group.");
                if (res[0].status === "409") return reply("❌ User is already in the group.");
                
                return conn.sendMessage(from, { 
                    text: `✅ Successfully added @${num}.`, 
                    mentions: [jid] 
                }, { quoted: msg });
            }

            // ==========================================
            // PROMOTE
            // ==========================================
            if (action === "promote") {
                const target = getTarget();
                if (!target) return reply("❌ Tag or reply to the user you want to promote.");
                
                await conn.groupParticipantsUpdate(from, [target], "promote");
                return conn.sendMessage(from, { 
                    text: `✅ Successfully promoted @${target.split('@')[0]} to admin.`, 
                    mentions: [target] 
                }, { quoted: msg });
            }

            // ==========================================
            // DEMOTE
            // ==========================================
            if (action === "demote") {
                const target = getTarget();
                if (!target) return reply("❌ Tag or reply to the user you want to demote.");
                
                await conn.groupParticipantsUpdate(from, [target], "demote");
                return conn.sendMessage(from, { 
                    text: `✅ Successfully demoted @${target.split('@')[0]} from admin.`, 
                    mentions: [target] 
                }, { quoted: msg });
            }

            // ==========================================
            // MUTE / UNMUTE
            // ==========================================
            if (action === "mute") {
                await conn.groupSettingUpdate(from, "announcement");
                return reply("🔒 Group has been muted (Only admins can send messages).");
            }

            if (action === "unmute") {
                await conn.groupSettingUpdate(from, "not_announcement");
                return reply("🔓 Group has been unmuted (Everyone can send messages).");
            }

            // ==========================================
            // LINK / REVOKE
            // ==========================================
            if (action === "link") {
                const code = await conn.groupInviteCode(from);
                return reply(`🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}`);
            }

            if (action === "revoke") {
                await conn.groupRevokeInvite(from);
                return reply("✅ Group invite link has been reset successfully.");
            }

            // ==========================================
            // SUBJECT (Name)
            // ==========================================
            if (action === "subject") {
                const newSubject = args.slice(1).join(" ");
                if (!newSubject) return reply("❌ Provide a new name for the group.");
                
                await conn.groupUpdateSubject(from, newSubject);
                return reply(`✅ Group name updated to: *${newSubject}*`);
            }

            // ==========================================
            // DESC (Description)
            // ==========================================
            if (action === "desc") {
                const newDesc = args.slice(1).join(" ");
                if (!newDesc) return reply("❌ Provide a new description.");
                
                await conn.groupUpdateDescription(from, newDesc);
                return reply(`✅ Group description updated successfully.`);
            }

            return reply(`❌ Unknown action: \`${action}\`. Type \`.group\` to see usage.`);

        } catch (error) {
            console.error("Group Command Error:", error);
            return reply(`❌ Failed to execute command: ${error.message}`);
        }
    }
};
