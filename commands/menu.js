const fs = require("fs");
const path = require("path");

module.exports = {
    name: "menu",
    aliases: ["help", "commands"],
    description: "Show bot menu",
    async execute(conn, msg, args, ctx) {
        try {
            const { config } = ctx;
            
            // Build the menu text safely
            let menuText = `╭─❏ *${config.botName}*\n│ ${config.footer}\n│ v${config.version}\n╰───────────────\n\n`;

            // List commands manually to prevent file-system crashes
            menuText += `*Available Commands:*\n`;
            menuText += `• ${config.prefix}ping — Check bot latency\n`;
            menuText += `• ${config.prefix}menu — Show this menu\n`;
            menuText += `• ${config.prefix}owner — Get owner contact\n\n`;
            
            menuText += `_Prefix: ${config.prefix}_`;

            // Send the menu
            await conn.sendMessage(ctx.from, { text: menuText }, { quoted: msg });
            
        } catch (error) {
            console.error("Menu command error:", error);
            // If menu fails, try to send a simple fallback message
            try {
                await conn.sendMessage(ctx.from, { text: "❌ Failed to load menu." }, { quoted: msg });
            } catch (e) {}
        }
    }
};