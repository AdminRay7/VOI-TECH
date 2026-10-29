// lib/watchdog.js — simple heartbeat tracker
const beats = new Map();

function init() {}

function heartbeat(id = "default") {
    beats.set(id, Date.now());
}

function lastBeat(id = "default") {
    return beats.get(id) || 0;
}

module.exports = { init, heartbeat, lastBeat };