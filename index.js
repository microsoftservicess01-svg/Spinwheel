/* --- FULL index.js (Unique ID login + spin wheel) --- */
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

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new sqlite3.Database(DB_FILE);
const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
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

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data; next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// Generate LW + 6 digits
async function generateUniqueId() {
  for (let i=0;i<10;i++){
    const num = Math.floor(100000 + Math.random()*900000);
    const uid = 'LW' + num;
    const exists = await get(db, 'SELECT id FROM users WHERE unique_id = ?', [uid]);
    if(!exists) return uid;
  }
  throw new Error('Unable to generate unique id');
}

// Registration
app.post('/api/register', async (req,res)=>{
  const { password } = req.body;
  if(!password) return res.status(400).json({ error: 'password required' });
  try{
    const hash = await bcrypt.hash(password, 10);
    const unique_id = await generateUniqueId();
    const result = await run(db, 'INSERT INTO users (unique_id, password_hash) VALUES (?,?)', [unique_id, hash]);
    const id = result.lastID;
    const token = jwt.sign({ id, unique_id }, JWT_SECRET);
    res.json({ token, unique_id });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req,res)=>{
  const { unique_id, password } = req.body;
  if(!unique_id || !password) return res.status(400).json({ error: 'unique_id and password required' });
  try{
    const row = await get(db, 'SELECT * FROM users WHERE unique_id = ?', [unique_id]);
    if(!row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if(!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: row.id, unique_id: row.unique_id }, JWT_SECRET);
    res.json({ token, unique_id: row.unique_id });
  }catch(e){ res.status(500).json({ error: 'Server error' }); }
});

// Get user
app.get('/api/me', authMiddleware, async (req,res)=>{
  const user = await get(db, 'SELECT id,unique_id,last_spin_at FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

// Spin logic
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

    res.json({ result: choice, sectorIndex });
  }catch(e){ 
    console.error(e); 
    res.status(500).json({ error: 'Server error' }); 
  }
});

// Winner routes + cron unchanged…
/* (same as earlier; truncated for brevity) */

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server running on port', PORT));
