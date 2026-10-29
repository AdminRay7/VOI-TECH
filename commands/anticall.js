module.exports = {
    name: "anticall",
    category: "settings",
    aliases: ["ac"],
    description: "Auto-reject incoming calls",
    
    // We set up the listener for this specific connection
    async execute(conn, msg, args, ctx) {
        return ctx.reply("📞 Anti-call is built into the bot's core and is always active.");
    },

    // This is a special hook we will call from index.js
    setupCallListener(conn) {
        conn.ev.on('call', async (calls) => {
            for (const call of calls) {
                if (call.status === 'offer') {
                    console.log(`📞 Incoming call from ${call.from} - Rejecting...`);
                    
                    try {
                        // 1. Reject the call immediately
                        await conn.rejectCall(call.id, call.from);
                        
                        // 2. Send a message to the caller explaining why
                        await conn.sendMessage(call.from, { 
                            text: "⚠️ *Anti-Call is Active* ⚠️\n\nI am a bot and I cannot receive voice or video calls. Please send a text message instead! 😊" 
                        });
                    } catch (error) {
                        console.error("Failed to reject call:", error.message);
                    }
                }
            }
        });
    }
};
