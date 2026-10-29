// lib/services.js — central wiring for dedupe / gameEngine / watchdog
const dedupe = require("./dedupe");
const gameEngine = require("./gameEngine");
const watchdog = require("./watchdog");

let initialized = false;

function init(config) {
    if (initialized) return;
    initialized = true;
    try { dedupe.init?.(); } catch (e) { console.error("dedupe.init:", e.message); }
    try { gameEngine.init?.(config); } catch (e) { console.error("gameEngine.init:", e.message); }
    try { watchdog.init?.(config); } catch (e) { console.error("watchdog.init:", e.message); }
}

module.exports = { init, dedupe, gameEngine, watchdog };