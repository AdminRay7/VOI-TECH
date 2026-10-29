// lib/aiState.js
let isAutoReplyEnabled = true; // Default state

module.exports = {
    isEnabled: () => isAutoReplyEnabled,
    setEnabled: (state) => { isAutoReplyEnabled = state; }
};
