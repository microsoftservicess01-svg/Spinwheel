const express = require('express');
const bodyParser = require('body-parser');
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
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin_secret';

try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); } catch (e) { console.warn('mkdir err', e && e.message); }

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) { console.error('DB open error', err); process.exit(1); }
  console.log('DB opened at', DB_FILE);
});

const initPath = path.join(__dirname, 'db', 'init.sql');
if (!fs.existsSync(initPath)) { console.error('Missing db/init.sql'); }
else {
  const sql = fs.readFileSync(initPath, 'utf8');
  db.exec(sql, (err) => { if (err) console.error('DB init error', err && err.message); else console.log('DB initialized'); });
}

function run(db, sql, params=[]) {
  return new Promise((res, rej) => db.run(sql, params, function(err){ if(err) rej(err); else res({ lastID: this.lastID, changes: this.changes }); }));
}
function get(db, sql, params=[]) {
  return new Promise((res, rej) => db.get(sql, params, (err,row) => { if(err) rej(err); else res(row); }));
}
function all(db, sql, params=[]) {
  return new Promise((res, rej) => db.all(sql, params, (err,rows) => { if(err) rej(err); else res(rows); }));
}

// bootstrap quiz questions from public/quiz_data.json if table empty
async function bootstrapQuiz() {
  try {
    const cnt = await get(db, 'SELECT COUNT(*) as cnt FROM quiz_questions', []);
    if (cnt && cnt.cnt > 0) return;
  } catch(e) {}
  const qPath = path.join(__dirname, 'public', 'quiz_data.json');
  if (!fs.existsSync(qPath)) return;
  try {
    const raw = fs.readFileSync(qPath, 'utf8');
    const questions = JSON.parse(raw);
    const ins = 'INSERT INTO quiz_questions (q_key, question, options_json, correct_index) VALUES (?,?,?,?)';
    for (const q of questions) {
      try { await run(db, ins, [q.q_key||null, q.question, JSON.stringify(q.options||[]), q.correct_index||0]); } catch(e){ console.warn('quiz insert err', e && e.message); }
    }
    console.log('Bootstrapped quiz questions');
  } catch(e) { console.error('bootstrap quiz err', e && e.message); }
}
bootstrapQuiz();

// generate Quiz ID QW + 6 digits
async function generateQuizId() {
  for (let i=0;i<20;i++) {
    const num = Math.floor(100000 + Math.random()*900000);
    const qid = 'QW' + num;
    const exists = await get(db, 'SELECT id FROM quiz_claims WHERE quiz_id = ? LIMIT 1', [qid]);
    if (!exists) return qid;
  }
  throw new Error('Cannot generate quiz id');
}

app.get('/api/health', (req,res) => res.json({ ok:true }));

// spin endpoint (one spin per client per day)
app.post('/api/spin', async (req,res) => {
  try {
    const client_id = req.body && req.body.client_id ? String(req.body.client_id) : null;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const last = await get(db, 'SELECT spun_at FROM spins WHERE client_id = ? ORDER BY spun_at DESC LIMIT 1', [client_id]);
    if (last) {
      const now = Math.floor(Date.now()/1000);
      if (now - last.spun_at < 24*60*60) return res.status(429).json({ error: 'You can spin only once every 24 hours' });
    }
    const sectors = ['TRY','TRY','TRY','TRY','TRY','TRY','TRY','GIFT'];
    const sectorIndex = Math.floor(Math.random()*sectors.length);
    const result = sectors[sectorIndex];
    await run(db, 'INSERT INTO spins (client_id, result) VALUES (?,?)', [client_id, result]);
    if (result === 'GIFT') {
      const today = new Date().toISOString().slice(0,10);
      const exists = await get(db, 'SELECT id FROM gift_claims WHERE client_id = ? AND claim_date = ?', [client_id, today]);
      if (!exists) await run(db, 'INSERT INTO gift_claims (client_id, claim_date) VALUES (?,?)', [client_id, today]);
    }
    return res.json({ result, sectorIndex });
  } catch(e) { console.error('spin err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// quiz: one attempt per client per day
app.post('/api/quiz/submit', async (req,res) => {
  try {
    const body = req.body || {};
    const client_id = body.client_id ? String(body.client_id) : null;
    const question_id = Number(body.question_id || 0);
    const selected_index = Number(body.selected_index);
    if (!client_id || !question_id || isNaN(selected_index)) return res.status(400).json({ error: 'client_id, question_id, selected_index required' });

    const today = new Date().toISOString().slice(0,10);
    const prev = await get(db, 'SELECT id, is_correct FROM quiz_claims WHERE client_id = ? AND claim_date = ? LIMIT 1', [client_id, today]);
    if (prev) return res.status(429).json({ error: 'You have already attempted the quiz today. Try again tomorrow.' });

    const q = await get(db, 'SELECT id, correct_index FROM quiz_questions WHERE id = ?', [question_id]);
    if (!q) return res.status(404).json({ error: 'Question not found' });

    const is_correct = (selected_index === q.correct_index) ? 1 : 0;
    let quiz_id_to_use = '';
    if (is_correct) {
      quiz_id_to_use = await generateQuizId();
    }
    await run(db, 'INSERT INTO quiz_claims (client_id, quiz_id, question_id, selected_index, is_correct, claim_date) VALUES (?,?,?,?,?,?)', [client_id, quiz_id_to_use, question_id, selected_index, is_correct, today]);

    if (is_correct) {
      const exists = await get(db, 'SELECT id FROM clients WHERE client_id = ? LIMIT 1', [client_id]);
      if (!exists) await run(db, 'INSERT INTO clients (client_id) VALUES (?)', [client_id]);
      return res.json({ correct: true, quiz_id: quiz_id_to_use, message: 'Correct! You are entered into today\'s quiz draw for ₹200.' });
    } else {
      return res.json({ correct: false, message: 'Incorrect. You have used your one attempt for today.' });
    }
  } catch(e) { console.error('quiz submit err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// quiz questions get
app.get('/api/quiz/all', async (req,res) => {
  try {
    const rows = await all(db, 'SELECT id, question, options_json FROM quiz_questions ORDER BY id ASC', []);
    const out = rows.map(r => ({ id: r.id, question: r.question, options: JSON.parse(r.options_json) }));
    return res.json({ questions: out });
  } catch(e) { console.error('quiz all err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// claimants today
app.get('/api/quiz/claimants/today', async (req,res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const rows = await all(db, 'SELECT client_id, quiz_id FROM quiz_claims WHERE is_correct = 1 AND claim_date = ?', [today]);
    return res.json({ claimants: rows });
  } catch(e) { console.error('quiz claimants err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// admin pick quiz winner
app.post('/api/admin/pick-quiz-winner', async (req,res) => {
  try {
    const secret = req.headers['x-admin-secret'] || '';
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_quiz_winner WHERE winner_date = ?', [today]);
    if (already) return res.json({ message: 'Already chosen', winner: already });
    const claimants = await all(db, 'SELECT quiz_id, client_id FROM quiz_claims WHERE is_correct = 1 AND claim_date = ?', [today]);
    if (!claimants || claimants.length === 0) return res.json({ message: 'No claimants today' });
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_quiz_winner (winner_client_id, winner_quiz_id, winner_date) VALUES (?,?,?)', [pick.client_id, pick.quiz_id, today]);
    const winnerRow = await get(db, 'SELECT * FROM daily_quiz_winner WHERE winner_date = ?', [today]);
    return res.json({ winner: winnerRow });
  } catch(e) { console.error('admin pick quiz err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// latest quiz winner
app.get('/api/quiz/winner/latest', async (req,res) => {
  try {
    const row = await get(db, 'SELECT * FROM daily_quiz_winner ORDER BY winner_date DESC LIMIT 1');
    return res.json({ winner: row || null });
  } catch(e) { console.error('quiz winner latest err', e && e.message); return res.status(500).json({ error: 'Server error' }); }
});

// cron to pick quiz winner at 00:30 IST
cron.schedule('30 0 * * *', async () => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const already = await get(db, 'SELECT * FROM daily_quiz_winner WHERE winner_date = ?', [today]);
    if (already) { console.log('Quiz winner already set for', today); return; }
    const claimants = await all(db, 'SELECT quiz_id, client_id FROM quiz_claims WHERE is_correct = 1 AND claim_date = ?', [today]);
    if (!claimants || claimants.length === 0) { console.log('No quiz claimants today', today); return; }
    const pick = claimants[Math.floor(Math.random()*claimants.length)];
    await run(db, 'INSERT INTO daily_quiz_winner (winner_client_id, winner_quiz_id, winner_date) VALUES (?,?,?)', [pick.client_id, pick.quiz_id, today]);
    console.log('Picked daily quiz winner for', today, 'client_id=', pick.client_id);
  } catch(e) { console.error('Cron quiz pick error', e && e.message); }
}, { timezone: 'Asia/Kolkata' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
