// Authentication functions
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const form = e.target;
    
    // Add loading state
    const button = form.querySelector('.login-btn');
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    button.disabled = true;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store token
            localStorage.setItem('token', data.token);
            
            // Show success
            button.innerHTML = '<i class="fas fa-check"></i> Success!';
            button.style.background = 'linear-gradient(45deg, #00ff00, #00cc00)';
            
            // Redirect to panel
            setTimeout(() => {
                window.location.href = 'panel.html';
            }, 1000);
        } else {
            // Show error
            form.classList.add('error');
            button.innerHTML = '<i class="fas fa-times"></i> Login Failed';
            button.style.background = 'linear-gradient(45deg, #ff0000, #cc0000)';
            
            setTimeout(() => {
                form.classList.remove('error');
                button.innerHTML = originalHTML;
                button.style.background = 'linear-gradient(45deg, #00ff00, #00cc00)';
                button.disabled = false;
            }, 3000);
        }
    } catch (error) {
        console.error('Login error:', error);
        button.innerHTML = '<i class="fas fa-times"></i> Network Error';
        button.style.background = 'linear-gradient(45deg, #ff0000, #cc0000)';
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = 'linear-gradient(45deg, #00ff00, #00cc00)';
            button.disabled = false;
        }, 3000);
    }
}

function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.querySelector('.toggle-password');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

// Check if already logged in
if (window.location.pathname.includes('login.html') && localStorage.getItem('token')) {
    window.location.href = 'panel.html';
}
