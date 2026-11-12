async execute(conn, msg, args, ctx) {
    const { from, isGroup, isOwner, userId } = ctx;
    
    // 1. The linked number is ALWAYS the owner
    if (!isOwner) return conn.sendMessage(from, { text: fancy('❌ Owner only.') });
    
    // 2. Must be in a group
    if (!isGroup) return conn.sendMessage(from, { text: fancy('❌ Group only command.') });

    // 3. Must be an admin (We check this manually to avoid LID errors)
    let botIsAdmin = false;
    try {
        const meta = await conn.groupMetadata(from);
        const botId = conn.user.id.split(':')[0].split('@')[0];
        const me = meta.participants.find(p => p.id.includes(botId));
        botIsAdmin = me?.admin === 'admin' || me?.admin === 'superadmin';
    } catch (e) {}

    // Because you are the owner, we don't block you even if bot isn't admin. 
    // We just warn you.
    if (!botIsAdmin) {
        await conn.sendMessage(from, { text: fancy('⚠️ Note: I am not an admin here. I can turn on Anti-Link, but I cannot delete messages until you promote me.') });
    }

    const action = (args[0] || '').toLowerCase();

    if (action === '') {
        const on = await autoToggles.get(userId, 'antilink', null, false);
        return conn.sendMessage(from, {
            text: fancy(`🔗 Smart Anti-Link: ${on ? '✅ ON' : '❌ OFF'}\n\nUses AI to detect spam links.`)
        }, { quoted: msg });
    }
    if (!['on', 'off'].includes(action)) {
        return conn.sendMessage(from, { text: fancy(`Usage: ${config.prefix}antilink on|off`) });
    }

    const value = action === 'on';
    await autoToggles.set(userId, 'antilink', null, value);
    return conn.sendMessage(from, {
        text: fancy(`✅ Smart Anti-Link ${value ? 'ENABLED' : 'DISABLED'}.`)
    }, { quoted: msg });
},