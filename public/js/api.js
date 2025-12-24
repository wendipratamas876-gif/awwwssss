// API helper functions
const API_BASE = window.location.origin;

class APIClient {
    constructor() {
        this.token = localStorage.getItem('token');
    }

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers
            });

            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem('token');
                window.location.href = 'login.html';
                return;
            }

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // Auth endpoints
    async login(username, password) {
        return this.request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    }

    // Attack endpoints
    async launchAttack(target, port, time, method) {
        return this.request('/api/attack', {
            method: 'POST',
            body: JSON.stringify({ target, port, time, method })
        });
    }

    async getOngoingAttacks() {
        return this.request('/api/attacks/ongoing');
    }

    async getAttackHistory() {
        return this.request('/api/attacks/history');
    }

    async stopAllAttacks() {
        return this.request('/api/attacks/stop', {
            method: 'POST'
        });
    }

    // VPS endpoints
    async getVPSList() {
        return this.request('/api/vps');
    }

    async addVPS(vpsData) {
        return this.request('/api/vps', {
            method: 'POST',
            body: JSON.stringify(vpsData)
        });
    }

    async deleteVPS(id) {
        return this.request(`/api/vps/${id}`, {
            method: 'DELETE'
        });
    }

    async checkVPSStatus() {
        return this.request('/api/vps/check', {
            method: 'POST'
        });
    }

    // Stats endpoint
    async getStats() {
        return this.request('/api/stats');
    }

    // Check host endpoint
    async checkHost(ip, port, mode) {
        return this.request('/api/check-host', {
            method: 'POST',
            body: JSON.stringify({ ip, port, mode })
        });
    }
}

// Create global API client
const api = new APIClient();

// Auto refresh token check
setInterval(() => {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const exp = payload.exp * 1000;
            const now = Date.now();
            
            if (now >= exp) {
                localStorage.removeItem('token');
                if (!window.location.pathname.includes('login.html')) {
                    window.location.href = 'login.html';
                }
            }
        } catch (e) {
            localStorage.removeItem('token');
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
        }
    }
}, 60000); // Check every minute
