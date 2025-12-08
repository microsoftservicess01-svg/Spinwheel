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

app.post('/api/register', async (req,res)=>{
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'email & password required' });
  try{
    const hash = await bcrypt.hash(password, 10);
    const result = await run(db, 'INSERT INTO users (email, password_hash) VALUES (?,?)', [email, hash]);
    const id = result.lastID;
    const token = jwt.sign({ id, email }, JWT_SECRET);
    res.json({ token });
  }catch(e){
    console.error(e);
    res.status(400).json({ error: 'Email already exists or invalid' });
  }
});

app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'email & password required' });
  try{
    const row = await get(db, 'SELECT * FROM users WHERE email = ?', [email]);
    if(!row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if(!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: row.id, email: row.email }, JWT_SECRET);
    res.json({ token });
  }catch(e){ res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/me', authMiddleware, async (req,res)=>{
  const user = await get(db, 'SELECT id,email,last_spin_at FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

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
    const choice = sectors[Math.floor(Math.random()*sectors.length)];
    await run(db, 'INSERT INTO spins (user_id,result) VALUES (?,?)', [user.id, choice]);
    await run(db, 'UPDATE users SET last_spin_at = ? WHERE id = ?', [Math.floor(Date.now()/1000), user.id]);
    if(choice === 'GIFT'){
      const today = new Date().toISOString().slice(0,10);
      const exists = await get(db, 'SELECT * FROM gift_claims WHERE user_id = ? AND claim_date = ?', [user.id, today]);
      if(!exists) await run(db, 'INSERT INTO gift_claims (user_id, claim_date) VALUES (?,?)', [user.id, today]);
    }
    res.json({ result: choice });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/gift-claimants', authMiddleware, async (req,res)=>{
  try{
    const today = new Date().toISOString().slice(0,10);
    const rows = await all(db, 'SELECT u.id,u.email,g.spun_at FROM gift_claims g JOIN users u ON g.user_id=u.id WHERE g.claim_date = ?', [today]);
    res.json({ claimants: rows });
  }catch(e){ res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/winner/latest', async (req,res)=>{
  try{
    const row = await get(db, 'SELECT w.*, u.email as winner_email FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id ORDER BY winner_date DESC LIMIT 1');
    res.json({ winner: row });
  }catch(e){ res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/pick-winner', async (req,res)=>{
  const secret = req.headers['x-admin-secret'] || '';
  if(secret !== (process.env.ADMIN_SECRET || 'admin_secret')) return res.status(403).json({ error: 'forbidden' });
  try{
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_winner WHERE winner_date = ?', [today]);
    if(already) return res.json({ message: 'Already chosen for today', winner: already });
    const claimants = await all(db, 'SELECT user_id FROM gift_claims WHERE claim_date = ?', [today]);
    if(!claimants || claimants.length === 0) return res.json({ message: 'No claimants today' });
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_winner (winner_user_id, winner_date) VALUES (?,?)', [pick.user_id, today]);
    const winnerRow = await get(db, 'SELECT w.*, u.email as winner_email FROM daily_winner w LEFT JOIN users u ON w.winner_user_id = u.id WHERE w.winner_date = ?', [today]);
    res.json({ winner: winnerRow });
  }catch(e){ console.error(e); res.status(500).json({ error: 'Server error' }); }
});

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
  }catch(e){ console.error('Cron pick-winner error', e); }
}, { timezone: 'Asia/Kolkata' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server running on port', PORT));
