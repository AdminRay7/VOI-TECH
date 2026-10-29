document.addEventListener("DOMContentLoaded", () => {
    const tabs = [
        { name: "Dashboard", icon: "📊", url: "/" },
        { name: "Pairing Panel", icon: "📱", url: "/pair" },
        { name: "AI Control", icon: "🤖", url: "/ai" },
        { name: "Settings", icon: "⚙️", url: "/settings" },
        { name: "Documentation", icon: "📖", url: "/docs" }
    ];

    let currentPath = window.location.pathname;
    
    // Handle the root path matching the Dashboard
    if (currentPath === "/" || currentPath === "") {
        currentPath = "/";
    }

    let linksHTML = "";
    tabs.forEach(tab => {
        // Check if the current URL matches the tab URL
        let isActive = currentPath === tab.url;
        
        // If they loaded /pair but the tab is /pair, highlight it
        // If they loaded /index, also highlight /pair
        if (tab.url === "/pair" && (currentPath === "/pair" || currentPath === "/index")) isActive = true;

        const activeClass = isActive ? "active" : "";
        
        linksHTML += `
            <a href="${tab.url}" class="sidebar-link ${activeClass}">
                <span class="sidebar-icon">${tab.icon}</span> ${tab.name}
            </a>
        `;
    });

    const sidebarHTML = `
        <div class="top-navbar">
            <button class="menu-btn" onclick="toggleSidebar()">
                <span></span>
                <span></span>
                <span></span>
            </button>
            <div class="navbar-brand">
                <span>🔑</span> 303-XMD
            </div>
        </div>

        <div class="custom-sidebar" id="globalSidebar">
            <div class="sidebar-header">
                <div class="navbar-brand"><span>🔑</span> Menu</div>
                <button class="close-btn" onclick="toggleSidebar()">✕</button>
            </div>
            <div class="sidebar-links">
                ${linksHTML}
            </div>
        </div>

        <div class="sidebar-overlay" id="globalOverlay" onclick="toggleSidebar()"></div>
    `;

    document.body.insertAdjacentHTML("afterbegin", sidebarHTML);

    const fontLink = document.createElement("link");
    fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
});

function toggleSidebar() {
    const sidebar = document.getElementById("globalSidebar");
    const overlay = document.getElementById("globalOverlay");
    sidebar.classList.toggle("open");
    overlay.classList.toggle("active");
}
