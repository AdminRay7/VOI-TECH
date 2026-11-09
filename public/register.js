<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Register - 303-XMD</title>
  <style>
    :root { --primary: #6366f1; --primary-hover: #4f46e5; --bg: #0a0a0f; }
    body { background: var(--bg); color: white; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-image: radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 50%); }
    .auth-box { background: rgba(20, 20, 30, 0.8); padding: 40px; border-radius: 12px; width: 100%; max-width: 400px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px); }
    h2 { text-align: center; margin-bottom: 20px; font-size: 24px; }
    input { width: 100%; padding: 14px; margin: 10px 0; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 8px; box-sizing: border-box; font-size: 15px; outline: none; }
    input:focus { border-color: var(--primary); }
    button { width: 100%; padding: 14px; background: var(--primary); border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 16px; margin-top: 15px; transition: 0.2s; }
    button:hover { background: var(--primary-hover); }
    .link { text-align: center; margin-top: 20px; font-size: 14px; color: #8b8ba8; }
    .link a { color: var(--primary); text-decoration: none; font-weight: 600; }
    .error { color: #f87171; text-align: center; font-size: 14px; margin-top: 10px; display: none; }
  </style>
</head>
<body>
  <div class="auth-box">
    <h2>Create Account</h2>
    <input type="email" id="email" placeholder="Email Address (Admin Email for Admin role)">
    <input type="password" id="password" placeholder="Password">
    <button onclick="register()">Register</button>
    <div class="error" id="error-msg"></div>
    <div class="link">Already have an account? <a href="/login">Login</a></div>
  </div>

  <script>
    async function register() {
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;
      const errorEl = document.getElementById("error-msg");

      if (!email || !password) return alert("Please fill all fields");

      try {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        alert("Registration successful! Please login.");
        window.location.href = "/login";
      } catch (err) {
        errorEl.style.display = "block";
        errorEl.textContent = err.message;
      }
    }
  </script>
</body>
</html>