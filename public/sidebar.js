// public/sidebar.js

document.addEventListener("DOMContentLoaded", () => {
    // 1. Define all your web pages here
    const tabs = [
        { name: "Dashboard", icon: "📊", url: "/" },
        { name: "Pairing Panel", icon: "📱", url: "/index.html" },
        { name: "AI Control", icon: "🤖", url: "/ai.html" },
        { name: "Settings", icon: "⚙️", url: "/settings.html" },
        { name: "Documentation", icon: "📖", url: "/docs.html" }
    ];

    // 2. Get current URL path
    let currentPath = window.location.pathname;
    if (currentPath === "/" || currentPath === "") currentPath = "/";

    // 3. Build the Navigation Links HTML
    let linksHTML = "";
    tabs.forEach(tab => {
        // Highlight the active tab
        const isActive = currentPath === tab.url || (currentPath === "/" && tab.url === "/");
        const activeClass = isActive ? "active" : "";
        
        linksHTML += `
            <a href="${tab.url}" class="sidebar-link ${activeClass}">
                <span class="sidebar-icon">${tab.icon}</span> ${tab.name}
            </a>
        `;
    });

    // 4. Build the Full HTML Layout
    const sidebarHTML = `
        <!-- Top Navbar with Hamburger -->
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

        <!-- Slide-out Menu -->
        <div class="custom-sidebar" id="globalSidebar">
            <div class="sidebar-header">
                <div class="navbar-brand"><span>🔑</span> Menu</div>
                <button class="close-btn" onclick="toggleSidebar()">✕</button>
            </div>
            <div class="sidebar-links">
                ${linksHTML}
            </div>
        </div>

        <!-- Dark Overlay -->
        <div class="sidebar-overlay" id="globalOverlay" onclick="toggleSidebar()"></div>
    `;

    // 5. Inject into the page (at the very top of the body)
    document.body.insertAdjacentHTML("afterbegin", sidebarHTML);

    // 6. Load Google Fonts for the sidebar
    const fontLink = document.createElement("link");
    fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
});

// 7. Toggle Function
function toggleSidebar() {
    const sidebar = document.getElementById("globalSidebar");
    const overlay = document.getElementById("globalOverlay");
    sidebar.classList.toggle("open");
    overlay.classList.toggle("active");
}
