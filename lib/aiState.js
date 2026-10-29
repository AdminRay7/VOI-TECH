// lib/aiState.js
let isAutoReplyEnabled = true; 

module.exports = {
    isEnabled: () => isAutoReplyEnabled,
    setEnabled: (state) => { isAutoReplyEnabled = state; }
};
