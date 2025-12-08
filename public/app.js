// public/app.js - robust frontend for registration/login/spin + wheel animation
document.addEventListener('DOMContentLoaded', () => {
  let token = null;

  // robust api helper that tries to parse JSON and returns object { ok, status, body }
  async function apiFetch(path, opts={}) {
    try {
      const headers = opts.headers || {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch(e){ json = { error: 'Invalid JSON from server' }; }
      return { ok: res.ok, status: res.status, body: json };
    } catch (e) {
      console.error('Network error', e);
      return { ok: false, status: 0, body: { error: 'Network error' } };
    }
  }

  // UI elements
  const registerBtn = document.getElementById('registerBtn');
  const regPassword = document.getElementById('regPassword');
  const regMsg = document.getElementById('reg-msg');

  const loginBtn = document.getElementById('loginBtn');
  const loginUniqueId = document.getElementById('loginUniqueId');
  const loginPassword = document.getElementById('loginPassword');
  const loginMsg = document.getElementById('login-msg');

  const authBox = document.getElementById('auth');
  const mainBox = document.getElementById('main');
  const welcomeEl = document.getElementById('welcome');
  const spinResultEl = document.getElementById('spin-result');
  const todayWinnerEl = document.getElementById('today-winner');
  const spinBtn = document.getElementById('spinBtn');
  const wheel = document.getElementById('wheel');

  const SECTORS = 8;
  let currentRotation = 0;

  function sectorToAngle(index){
    const size = 360 / SECTORS;
    const rand = (Math.random()*14)-7; // -7..+7 deg randomness
    return 360 - (index * size + size/2) + rand;
  }

  // register
  registerBtn.addEventListener('click', async () => {
    regMsg.innerText = 'Registering...';
    const password = regPassword.value || '';
    const resp = await apiFetch('/register', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password })
    });
    if (!resp.ok) {
      regMsg.innerText = resp.body?.error || 'Registration failed';
      console.error('Register failed', resp);
      return;
    }
    token = resp.body.token;
    regMsg.innerText = `Registered! Your Unique ID: ${resp.body.unique_id}. Save it.`;
    afterLogin(resp.body.unique_id);
  });

  // login
  loginBtn.addEventListener('click', async () => {
    loginMsg.innerText = 'Logging in...';
    const unique_id = loginUniqueId.value || '';
    const password = loginPassword.value || '';
    const resp = await apiFetch('/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ unique_id, password })
    });
    if (!resp.ok) {
      loginMsg.innerText = resp.body?.error || 'Login failed';
      console.error('Login failed', resp);
      return;
    }
    token = resp.body.token;
    afterLogin(resp.body.unique_id);
  });

  function afterLogin(uid) {
    authBox.style.display = 'none';
    mainBox.style.display = 'block';
    welcomeEl.innerText = 'Welcome, ' + uid;
    loadWinner();
  }

  async function loadWinner(){
    const resp = await apiFetch('/winner/latest');
    if(!resp.ok) {
      todayWinnerEl.innerText = 'Unable to load winner';
      console.error('winner/latest error', resp);
      return;
    }
    const w = resp.body.winner;
    if(w && w.winner_unique_id) {
      todayWinnerEl.innerText = `${w.winner_unique_id} (date: ${w.winner_date})`;
    } else {
      todayWinnerEl.innerText = 'No winner yet';
    }
  }

  // spinning
  spinBtn.addEventListener('click', async () => {
    spinBtn.disabled = true;
    spinResultEl.innerText = 'Spinning...';
    // call server
    const resp = await apiFetch('/spin', { method: 'POST' });
    if (!resp.ok) {
      spinResultEl.innerText = resp.body?.error || 'Spin failed';
      console.error('Spin error', resp);
      spinBtn.disabled = false;
      return;
    }
    const body = resp.body;
    const idx = (typeof body.sectorIndex === 'number') ? body.sectorIndex : (body.result === 'GIFT' ? 7 : 0);
    const fullTurns = 6 + Math.floor(Math.random()*4);
    const targetAngle = fullTurns*360 + sectorToAngle(idx);

    currentRotation = currentRotation % 360;
    const finalRotation = currentRotation + targetAngle;
    wheel.style.transition = 'transform 4s cubic-bezier(.2,.9,.2,1)';
    wheel.style.transform = `rotate(${finalRotation}deg)`;

    // show result when anim ends
    const onEnd = () => {
      wheel.removeEventListener('transitionend', onEnd);
      wheel.style.transition = '';
      currentRotation = finalRotation % 360;
      if (body.result === 'GIFT') {
        spinResultEl.innerText = '🎉 You landed on the Gift Chance! You are entered into today\'s draw for ₹250.';
      } else {
        spinResultEl.innerText = 'Try Again!';
      }
      loadWinner();
      spinBtn.disabled = false;
    };
    wheel.addEventListener('transitionend', onEnd);
  });

  // initial UI state
  authBox.style.display = 'block';
  mainBox.style.display = 'none';
});
