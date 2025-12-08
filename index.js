// index.js (debug-friendly, safer DB checks, clearer errors returned for registration)
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'app.db');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin_secret';

// Ensure data directory exists and is writable
try {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
} catch (e) {
  console.error('Failed to create data directory:', e && e.message);
}

// Basic filesystem checks (will print on startup)
function checkFs() {
  try {
    const dbDir = path.dirname(DB_FILE);
    const stat = fs.statSync(dbDir);
    console.log('DB dir exists:', dbDir, 'mode:', (stat.mode & 0o777).toString(8));
  } catch (e) {
    console.warn('DB dir check failed:', e && e.message);
  }
  try {
    const initPath = path.join(__dirname, 'db', 'init.sql');
    console.log('init.sql exists:', fs.existsSync(initPath), '->', initPath);
  } catch (e) {
    console.warn('init.sql exists check failed:', e && e.message);
  }
}
checkFs();

let db;
try {
  db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
      console.error('Failed opening DB:', err);
      process.exit(1);
    } else {
      console.log('Opened DB at', DB_FILE);
    }
  });
} catch (e) {
  console.error('DB open exception:', e);
  process.exit(1);
}

const initPath = path.join(__dirname, 'db', 'init.sql');
if (!fs.existsSync(initPath)) {
  console.error('Missing db/init.sql - application cannot initialize DB. Please upload db/init.sql');
  // Keep server running so you can inspect logs; registration will fail until file present.
} else {
  const initSql = fs.readFileSync(initPath, 'utf8');
  db.exec(initSql, (err) => {
    if (err) console.error('DB init error:', err && err.message);
    else console.log('DB initialized (or already present).');
  });
}

// promisified helpers
function run(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err){
      if (err) return reject(err);
      // include lastID to caller
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function get(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err,row) => { if(err) reject(err); else resolve(row); });
  });
}
function all(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err,rows) => { if(err) reject(err); else resolve(rows); });
  });
}

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth header' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data; next();
  } catch (e) {
    console.warn('JWT verify failed:', e && e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Unique ID generator LW + 6 digits
async function generateUniqueId() {
  for (let i=0;i<50;i++){
    const num = Math.floor(100000 + Math.random()*900000);
    const uid = 'LW' + num;
    try {
      const exists = await get(db, 'SELECT id FROM users WHERE unique_id = ?', [uid]);
      if (!exists) return uid;
    } catch (e) {
      console.warn('generateUniqueId DB check error:', e && e.message);
      // if a transient DB error occurs, loop and try again
    }
  }
  throw new Error('Unable to generate unique id after many attempts');
}

// --- Routes ---

app.get('/api/health', (req,res) => res.json({ ok:true, DB_FILE }));

// Debug endpoint: returns FS checks & env info (no secrets)
app.get('/api/_debug_fs', (req,res) => {
  try {
    const dbDir = path.dirname(DB_FILE);
    const initExists = fs.existsSync(path.join(__dirname,'db','init.sql'));
    const dataExists = fs.existsSync(dbDir);
    let dbStat = null;
    try { dbStat = fs.statSync(dbDir); } catch(e) { dbStat = { error: e.message }; }
    return res.json({ ok:true, initExists, dataExists, dbDir, dbStat });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// Register
app.post('/api/register', async (req,res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password required' });

    // quick pre-checks
    if (!fs.existsSync(path.join(__dirname,'db','init.sql'))) {
      return res.status(500).json({ error: 'Server misconfiguration: db/init.sql missing' });
    }

    const hash = await bcrypt.hash(password, 10);
    const unique_id = await generateUniqueId();

    const result = await run(db, 'INSERT INTO users (unique_id, password_hash) VALUES (?, ?)', [unique_id, hash]);
    const id = result.lastID;
    const token = jwt.sign({ id, unique_id }, JWT_SECRET);
    console.log('Registered new user', unique_id, 'id=', id);
    return res.json({ token, unique_id });
  } catch (err) {
    // log full error server-side, return actionable message client-side
    console.error('Register error:', err && err.stack ? err.stack : err && err.message ? err.message : err);
    // If it's a sqlite cannot open error, return helpful hint
    if (err && /SQLITE_CANTOPEN/.test(err.message || '')) {
      return res.status(500).json({ error: 'Database file cannot be opened (check DATABASE_FILE and data dir permissions)' });
    }
    return res.status(500).json({ error: err.message ? err.message : 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req,res) => {
  try {
    const { unique_id, password } = req.body || {};
    if (!unique_id || !password) return res.status(400).json({ error: 'unique_id and password required' });

    const row = await get(db, 'SELECT * FROM users WHERE unique_id = ?', [unique_id]);
    if (!row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: row.id, unique_id: row.unique_id }, JWT_SECRET);
    return res.json({ token, unique_id: row.unique_id });
  } catch (err) {
    console.error('Login error:', err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// /api/me
app.get('/api/me', authMiddleware, async (req,res) => {
  try {
    const user = await get(db, 'SELECT id,unique_id,last_spin_at FROM users WHERE id = ?', [req.user.id]);
    return res.json({ user });
  } catch (err) {
    console.error('Me error:', err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Spin
app.post('/api/spin', authMiddleware, async (req,res) => {
  try {
    const user = await get(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.last_spin_at) {
      const last = user.last_spin_at;
      const now = Math.floor(Date.now() / 1000);
      if (now - last < 24*60*60) {
        const hoursLeft = Math.ceil((24*60*60 - (now-last))/3600);
        return res.status(429).json({ error: `You can spin again after ${hoursLeft} hour(s).` });
      }
    }

    const sectors = [ 'TRY','TRY','TRY','TRY','TRY','TRY','TRY','GIFT' ];
    const sectorIndex = Math.floor(Math.random()*sectors.length);
    const choice = sectors[sectorIndex];

    await run(db, 'INSERT INTO spins (user_id,result) VALUES (?,?)', [user.id, choice]);
    await run(db, 'UPDATE users SET last_spin_at = ? WHERE id = ?', [Math.floor(Date.now()/1000), user.id]);

    if (choice === 'GIFT') {
      const today = new Date().toISOString().slice(0,10);
      const exists = await get(db, 'SELECT * FROM gift_claims WHERE user_id = ? AND claim_date = ?', [user.id, today]);
      if (!exists) await run(db, 'INSERT INTO gift_claims (user_id, claim_date) VALUES (?,?)', [user.id, today]);
    }

    return res.json({ result: choice, sectorIndex });
  } catch (err) {
    console.error('Spin error:', err && err.stack ? err.stack : err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// gift-claimants
app.get('/api/gift-claimants', authMiddleware, async (req,res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const rows = await all(db, 'SELECT u.id,u.unique_id,g.spun_at FROM gift_claims g JOIN users u ON g.user_id=u.id WHERE g.claim_date = ?', [today]);
    return res.json({ claimants: rows });
  } catch (err) {
    console.error('gift-claimants error:', err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// winner/latest
app.get('/api/winner/latest', async (req,res) => {
  try {
    const row = await get(db, 'SELECT w.*, u.unique_id as winner_unique_id FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id ORDER BY winner_date DESC LIMIT 1');
    return res.json({ winner: row || null });
  } catch (err) {
    console.error('winner/latest error:', err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// admin pick winner
app.post('/api/admin/pick-winner', async (req,res) => {
  try {
    const secret = req.headers['x-admin-secret'] || '';
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_winner WHERE winner_date = ?', [today]);
    if (already) return res.json({ message: 'Already chosen for today', winner: already });
    const claimants = await all(db, 'SELECT user_id FROM gift_claims WHERE claim_date = ?', [today]);
    if (!claimants || claimants.length === 0) return res.json({ message: 'No claimants today' });
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_winner (winner_user_id, winner_date) VALUES (?,?)', [pick.user_id, today]);
    const winnerRow = await get(db, 'SELECT w.*, u.unique_id as winner_unique_id FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id WHERE w.winner_date = ?', [today]);
    return res.json({ winner: winnerRow });
  } catch (err) {
    console.error('admin pick error:', err && err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// cron: daily pick
cron.schedule('5 0 * * *', async () => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_winner WHERE winner_date = ?', [today]);
    if (already) { console.log('Winner already set for', today); return; }
    const claimants = await all(db, 'SELECT user_id FROM gift_claims WHERE claim_date = ?', [today]);
    if (!claimants || claimants.length === 0) { console.log('No claimants today', today); return; }
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_winner (winner_user_id, winner_date) VALUES (?,?)', [pick.user_id, today]);
    console.log('Picked daily winner for', today, 'user_id=', pick.user_id);
  } catch (err) {
    console.error('Cron pick-winner error:', err && err.message);
  }
}, { timezone: 'Asia/Kolkata' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
