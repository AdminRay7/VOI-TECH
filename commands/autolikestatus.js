// ============================================================
//   STATUS & STATUS REVOKE HANDLING (Bulletproof)
// ============================================================
if (isStatus) {
    const isRevoke = !!msg.message?.protocolMessage;
    const targetId = isRevoke ? msg.message?.protocolMessage?.key?.id : msg.key.id;
    const isMyOwnStatus = (senderBare === sessionBare || senderBare === sessionLidBare);

    // 1. Run Auto-Toggles (View, Like, etc.)
    // Skip if it's the bot's own status to prevent loops, UNLESS it's a revoke
    if (!isMyOwnStatus || isRevoke) {
        const autoSnapshot = [...autoCache.values()];
        for (const mod of autoSnapshot) {
            if (typeof mod.onMessage !== 'function') continue;
            try {
                await mod.onMessage(conn, msg, cmdCtx);
            } catch (e) {
                console.error(`auto/${mod.name} (status):`, e.message);
            }
        }
    }

    // 2. Forward to Owner DM
    if (!isMyOwnStatus || isRevoke) {
        try {
            const cached = messageStore.get(targetId);
            if (cached) {
                const botJid = conn.user?.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                const senderName = cached.pushname || "Unknown";
                const alertType = isRevoke ? "🗑️ *Status Deleted Alert*" : "📱 *New Status Alert*";
                const prefixText = `${alertType}\n\n👤 *Sender:* ${senderName} (+${senderBare})\n\n`;
                
                if (cached.mediaBuffer && cached.mediaKind) {
                    const buf = cached.mediaBuffer;
                    const mime = cached.mediaMime || 'application/octet-stream';
                    const caption = cached.body ? `${prefixText}${cached.body}` : prefixText.trim();
                    
                    let content;
                    if (cached.mediaKind === 'image') content = { image: buf, mimetype: mime, caption };
                    else if (cached.mediaKind === 'video') content = { video: buf, mimetype: mime, caption };
                    else if (cached.mediaKind === 'audio') {
                        content = { audio: buf, mimetype: mime, ptt: cached.ptt === true };
                        await conn.sendMessage(botJid, { text: prefixText });
                    }
                    else content = { text: caption };
                    
                    await conn.sendMessage(botJid, content);
                } else if (cached.body) {
                    await conn.sendMessage(botJid, { text: `${prefixText}${cached.body}` });
                }
            }
        } catch (e) { console.error('[Status Forward] error:', e.message); }
    }
    return; 
}