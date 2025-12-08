// index.js - complete backend (Unique ID LW + 6 digits, password auth, spin logic, daily winner)
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

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new sqlite3.Database(DB_FILE);
const initPath = path.join(__dirname, 'db', 'init.sql');
if (!fs.existsSync(initPath)) {
  console.error('Missing db/init.sql - make sure file exists');
  process.exit(1);
}
const initSql = fs.readFileSync(initPath, 'utf8');
db.exec(initSql, (err) => { if (err) console.error('DB init error', err); });

function run(db, sql, params=[]) {
  return new Promise((res, rej) => db.run(sql, params, function(err){ if(err) rej(err); else res(this); }));
}
function get(db, sql, params=[]) {
  return new Promise((res, rej) => db.get(sql, params, (err,row) => { if(err) rej(err); else res(row); }));
}
function all(db, sql, params=[]) {
  return new Promise((res, rej) => db.all(sql, params, (err,rows) => { if(err) rej(err); else res(rows); }));
}

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth header' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data; next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// Unique ID generator LW + 6 digits
async function generateUniqueId() {
  for (let i=0;i<20;i++){
    const num = Math.floor(100000 + Math.random()*900000);
    const uid = 'LW' + num;
    const exists = await get(db, 'SELECT id FROM users WHERE unique_id = ?', [uid]);
    if(!exists) return uid;
  }
  throw new Error('Unable to generate unique id');
}

// --- Routes ---

// Health
app.get('/api/health', (req,res) => res.json({ ok:true }));

// Register (password only, returns token + unique_id)
app.post('/api/register', async (req,res)=>{
  try{
    const { password } = req.body;
    if(!password) return res.status(400).json({ error: 'password required' });
    const hash = await bcrypt.hash(password, 10);
    const unique_id = await generateUniqueId();
    const result = await run(db, 'INSERT INTO users (unique_id, password_hash) VALUES (?,?)', [unique_id, hash]);
    const id = result.lastID;
    const token = jwt.sign({ id, unique_id }, JWT_SECRET);
    return res.json({ token, unique_id });
  }catch(e){
    console.error('Register error:', e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req,res)=>{
  try{
    const { unique_id, password } = req.body;
    if(!unique_id || !password) return res.status(400).json({ error: 'unique_id and password required' });
    const row = await get(db, 'SELECT * FROM users WHERE unique_id = ?', [unique_id]);
    if(!row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if(!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: row.id, unique_id: row.unique_id }, JWT_SECRET);
    return res.json({ token, unique_id: row.unique_id });
  }catch(e){
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get current user info
app.get('/api/me', authMiddleware, async (req,res)=>{
  try{
    const user = await get(db, 'SELECT id,unique_id,last_spin_at FROM users WHERE id = ?', [req.user.id]);
    return res.json({ user });
  }catch(e){
    console.error('Me error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Spin endpoint: returns result and sectorIndex
app.post('/api/spin', authMiddleware, async (req,res)=>{
  try{
    const user = await get(db, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
    if(!user) return res.status(404).json({ error: 'User not found' });

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

    if(choice === 'GIFT'){
      const today = new Date().toISOString().slice(0,10);
      const exists = await get(db, 'SELECT * FROM gift_claims WHERE user_id = ? AND claim_date = ?', [user.id, today]);
      if(!exists) await run(db, 'INSERT INTO gift_claims (user_id, claim_date) VALUES (?,?)', [user.id, today]);
    }

    return res.json({ result: choice, sectorIndex });
  }catch(e){
    console.error('Spin error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Gift claimants today (requires auth)
app.get('/api/gift-claimants', authMiddleware, async (req,res)=>{
  try{
    const today = new Date().toISOString().slice(0,10);
    const rows = await all(db, 'SELECT u.id,u.unique_id,g.spun_at FROM gift_claims g JOIN users u ON g.user_id=u.id WHERE g.claim_date = ?', [today]);
    return res.json({ claimants: rows });
  }catch(e){
    console.error('gift-claimants error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Latest winner (public)
app.get('/api/winner/latest', async (req,res)=>{
  try{
    const row = await get(db, 'SELECT w.*, u.unique_id as winner_unique_id FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id ORDER BY winner_date DESC LIMIT 1');
    return res.json({ winner: row || null });
  }catch(e){
    console.error('winner/latest error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Admin: pick winner now (header x-admin-secret)
app.post('/api/admin/pick-winner', async (req,res)=>{
  try{
    const secret = req.headers['x-admin-secret'] || '';
    if(secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_winner WHERE winner_date = ?', [today]);
    if(already) return res.json({ message: 'Already chosen for today', winner: already });
    const claimants = await all(db, 'SELECT user_id FROM gift_claims WHERE claim_date = ?', [today]);
    if(!claimants || claimants.length === 0) return res.json({ message: 'No claimants today' });
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_winner (winner_user_id, winner_date) VALUES (?,?)', [pick.user_id, today]);
    const winnerRow = await get(db, 'SELECT w.*, u.unique_id as winner_unique_id FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id WHERE w.winner_date = ?', [today]);
    return res.json({ winner: winnerRow });
  }catch(e){
    console.error('admin pick error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Cron: choose winner at 00:05 IST daily
cron.schedule('5 0 * * *', async () => {
  try{
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_winner WHERE winner_date = ?', [today]);
    if(already) { console.log('Winner already set for', today); return; }
    const claimants = await all(db, 'SELECT user_id FROM gift_claims WHERE claim_date = ?', [today]);
    if(!claimants || claimants.length === 0){ console.log('No claimants today', today); return; }
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_winner (winner_user_id, winner_date) VALUES (?,?)', [pick.user_id, today]);
    console.log('Picked daily winner for', today, 'user_id=', pick.user_id);
  }catch(e){
    console.error('Cron pick-winner error', e);
  }
}, { timezone: 'Asia/Kolkata' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server running on port', PORT));
