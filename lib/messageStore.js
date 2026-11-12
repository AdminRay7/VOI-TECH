const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const store = new Map();

function save(id, data) {
    if (!id) return;
    store.set(id, { data, ts: Date.now() });
    if (store.size > MAX_ENTRIES) {
        const first = store.keys().next().value;
        store.delete(first);
    }
}

function get(id) {
    const e = store.get(id);
    if (!e) return null;
    if (Date.now() - e.ts > TTL_MS) { store.delete(id); return null; }
    return e.data;
}

function remove(id) { store.delete(id); }
function clear() { store.clear(); }
function size() { return store.size; }

// Auto-expire stale entries
setInterval(() => {
    const now = Date.now();
    for (const [id, e] of store) {
        if (now - e.ts > TTL_MS) store.delete(id);
    }
}, 5 * 60 * 1000).unref();

module.exports = { save, get, remove, clear, size };