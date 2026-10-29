const fs = require('fs');
const path = require('path');
const config = require('../config');

const ASSETS_DIR = path.join(__dirname, '..', 'Assets');
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function findMenuImage() {
    if (!fs.existsSync(ASSETS_DIR)) return null;
    const files = fs.readdirSync(ASSETS_DIR);
    const img = files.find(f => /^menu\.(png|jpe?g|webp|gif)$/i.test(f));
    return img ? path.join(ASSETS_DIR, img) : null;
}

function scanCommands() {
    if (!fs.existsSync(COMMANDS_DIR)) return [];
    const seen = new Set();
    const list = [];

    const walk = (dir) => {
        for (const item of fs.readdirSync(dir)) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
                walk(itemPath);
            } else if (item.endsWith('.js')) {
                try {
                    delete require.cache[require.resolve(itemPath)];
                    const mod = require(itemPath);
                    if (!mod || typeof mod.execute !== 'function') continue;
                    if (seen.has(mod)) continue;
                    seen.add(mod);

                    const name = (mod.name || path.basename(itemPath, '.js')).toLowerCase();
                    const category = (mod.category || 'general').toLowerCase();

                    list.push({ name, category });
                } catch (e) {
                    console.error(`menu scan: ${itemPath}:`, e.message);
                }
            }
        }
    };

    walk(COMMANDS_DIR);
    return list;
}

function buildMenuText(cmds, ctx) {
    const groups = {};
    for (const c of cmds) {
        if (!groups[c.category]) groups[c.category] = [];
        groups[c.category].push(c.name);
    }

    const catOrder = Object.keys(groups).sort((a, b) => {
        if (a === 'general') return -1;
        if (b === 'general') return 1;
        return a.localeCompare(b);
    });

    const username = ctx?.pushname || 'User';

    let text =
        `╭─〔 🔑 ${ctx.fancy(config.botName)} 〕\n` +
        `│\n` +
        `│ 👤 ${ctx.fancy("user")}   : ${ctx.fancy(username)}\n` +
        `│ 🎯 ${ctx.fancy("prefix")} : ${config.prefix}\n` +
        `│\n` +
        `╰──────────────────────\n\n`;

    for (const cat of catOrder) {
        const names = groups[cat].sort();
        
        // FIXED: Removed .toUpperCase() so it stays in small letters
        text += `╭─〔 📌 ${ctx.fancy(cat)} 〕\n`;
        text += `│\n`;
        for (const n of names) {
            // Command names are kept lowercase (without fancy) so users can easily read them
            text += `│ ◇ ${config.prefix}${n}\n`;
        }
        text += `│\n`;
        text += `╰──────────────────────\n\n`;
    }

    text += `_${ctx.fancy(config.footer)}_`;
    return text;
}

module.exports = {
    name: 'menu',
    category: 'general',
    aliases: ['help', 'commands', 'cmds'],
    description: 'Show all available commands grouped by category',

    async execute(conn, msg, args, ctx) {
        const { from } = ctx;
        const cmds = scanCommands();

        if (!cmds.length) {
            return conn.sendMessage(from, { text: 'No commands found.' }, { quoted: msg });
        }

        const text = buildMenuText(cmds, ctx);
        const imgPath = findMenuImage();

        if (imgPath) {
            try {
                const buffer = await fs.promises.readFile(imgPath);
                return conn.sendMessage(from, {
                    image: buffer,
                    caption: text
                }, { quoted: msg });
            } catch (e) {
                console.error('Menu image send failed:', e.message);
            }
        }

        await conn.sendMessage(from, { text }, { quoted: msg });
    }
};