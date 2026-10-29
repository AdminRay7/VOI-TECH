// lib/dedupe.js — in-memory LRU of recent message IDs
const MAX = 2000;
const seen = new Map();

function isDuplicate(id, opts = {}) {
    if (!id) return false;
    if (seen.has(id)) return true;
    seen.set(id, Date.now());
    if (seen.size > MAX) {
        // delete oldest
        const first = seen.keys().next().value;
        seen.delete(first);
    }
    return false;
}

function init() {}
function _clear() { seen.clear(); }

module.exports = { isDuplicate, init, _clear };