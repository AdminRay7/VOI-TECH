const config = require("../config");
const { fancy } = require("../lib/font");
const { MessageLog } = require("../database/models");

module.exports = {
    name: "report",
    aliases: ["flag", "abuse"],
    description: "Flag a message as abuse",
    category: "owner", // <--- Your bot uses this to sort the menu
    ownerOnly: true,

    execute: async (conn, msg, args, { from, isGroup, senderJid, isOwner, sessionId }) => {
        if (!isOwner) return;

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

        if (!quoted || !quotedParticipant) {
            return conn.sendMessage(from, { 
                text: fancy("↩️ ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ᴍᴇꜱꜱᴀɢᴇ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ʀᴇᴘᴏʀᴛ, ᴛʜᴇɴ ꜱᴇɴᴅ .ʀᴇᴘᴏʀᴛ") 
            });
        }

        const reportedText = quoted.conversation || quoted.extendedTextMessage?.text || "[media or non-text message]";
        const reporterNumber = senderJid?.split("@")[0] || "unknown";
        const reportedNumber = quotedParticipant.split("@")[0] || "unknown";
        const reason = args.join(" ").trim() || "(no reason given)";

        const log = [
            `🚨 ${config.botName.toUpperCase()} ABUSE REPORT`,
            "──────────────",
            `Chat: ${from}`,
            `Group: ${isGroup ? "yes" : "no"}`,
            `Reported by: +${reporterNumber}`,
            `Reported user: +${reportedNumber}`,
            `Reason: ${reason}`,
            "──────────────",
            "Reported message:",
            reportedText.slice(0, 500),
            "──────────────",
            `Time: ${new Date().toISOString()}`,
            `Footer: ${config.footer}`
        ].join("\n");

        // 1. Confirm to the reporter
        await conn.sendMessage(from, {
            text: fancy("✅ ʀᴇᴘᴏʀᴛ ʟᴏɢɢᴇᴅ. ᴛʜᴇ ᴏᴡɴᴇʀ ʜᴀꜱ ʙᴇᴇɴ ɴᴏᴛɪꜰɪᴇᴅ.")
        });

        // 2. Notify the Owner via DM
        try {
            if (config.ownerNumber) {
                const ownerJid = config.ownerNumber + "@s.whatsapp.net";
                await conn.sendMessage(ownerJid, { text: log });
            }
        } catch (e) {
            console.error("report: could not notify owner:", e.message);
        }

        // 3. Save to Database
        try {
            await MessageLog.create({
                sessionId: sessionId || null,
                chatJid: from,
                chatName: from,
                chatType: isGroup ? "group" : "dm",
                isGroup,
                senderJid: quotedParticipant,
                senderName: "reported",
                senderPhone: reportedNumber,
                fromMe: false,
                body: reportedText.slice(0, 500),
                messageType: "abuse_report",
                replyToBody: `reason: ${reason} | reporter: +${reporterNumber}`,
                timestamp: new Date()
            });
        } catch (e) {
            console.error("report: could not log to DB:", e.message);
        }
    }
};
