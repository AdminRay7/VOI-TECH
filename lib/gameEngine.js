// lib/gameEngine.js — minimal stub (replace with real game logic)
const games = new Map(); // key: userId|from|sender -> state

const DIRECTIONS = new Set([
    "u","d","l","r","up","down","left","right",
    "⬆️","⬇️","⬅️","➡️","↑","↓","←","→",
    "w","a","s","again","restart"
]);

function key(userId, from, sender) {
    return `${userId}|${from}|${sender}`;
}

function init() {}

function hasActiveGame(userId, from, sender) {
    return games.has(key(userId, from, sender));
}

function isDirection(input) {
    if (!input) return false;
    return DIRECTIONS.has(String(input).toLowerCase().trim());
}

async function sendInput(userId, from, sender, input) {
    const k = key(userId, from, sender);
    if (!games.has(k)) return false;
    // TODO: apply input to game state
    return true;
}

module.exports = { init, hasActiveGame, isDirection, sendInput };