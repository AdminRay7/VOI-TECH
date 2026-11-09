document.addEventListener("DOMContentLoaded", () => {
    // 1. Check if user is logged in
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");
    
    // 2. Define tabs
    let tabs = [
        { name: "Dashboard", icon: "📊", url: "/dashboard" },
        { name: "Pairing Panel", icon: "📱", url: "/pair" },
        { name: "AI Control", icon: "🤖", url: "/ai" },
        { name: "Settings", icon: "⚙️", url: "/settings" },
        { name: "Documentation", icon: "📖", url: "/docs" }
    ];

    // 3. If Admin, add Admin Tab
    if (role === "admin") {
        tabs.push({ name: "Admin Panel", icon: "👑", url: "/admin" });
    }

    let currentPath = window.location.pathname;
    if (currentPath === "/" || currentPath === "") currentPath = "/dashboard";

    let linksHTML = "";
    tabs.forEach(tab => {
        let isActive = currentPath === tab.url;
        if (tab.url === "/pair" && (currentPath === "/pair" || currentPath === "/index")) isActive = true;
        
        const activeClass = isActive ? "active" : "";
        linksHTML += `
            <a href="${tab.url}" class="sidebar-link ${activeClass}">
                <span class="sidebar-icon">${tab.icon}</span> ${tab.name}
            </a>
        `;
    });

    // 4. Add Login/Logout button at the bottom of the sidebar
    if (token) {
        linksHTML += `
            <a href="#" class="sidebar-link" onclick="logout(event)" style="color: #f87171; margin-top: 20px;">
                <span class="sidebar-icon">🚪</span> Logout
            </a>
        `;
    } else {
        linksHTML += `
            <a href="/login" class="sidebar-link" style="color: #6366f1; margin-top: 20px;">
                <span class="sidebar-icon">🔐</span> Login / Register
            </a>
        `;
    }

    // 5. Build Sidebar HTML
    const sidebarHTML = `
        <div class="top-navbar">
            <button class="menu-btn" onclick="toggleSidebar()">
                <span></span><span></span><span></span>
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

    // 6. Inject into page
    document.body.insertAdjacentHTML("afterbegin", sidebarHTML);

    // Load Font
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

function logout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    window.location.href = "/login";
}