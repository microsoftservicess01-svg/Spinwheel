// public/app.js
let token = null;
const api = (path, opts={}) => fetch('/api'+path, Object.assign({headers: token?{Authorization:'Bearer '+token}:{}, credentials:'same-origin'}, opts)).then(r=>r.json());

async function fetchClientId(){
  // A small endpoint isn't present: just read from environment via rendering: we will rely on the current page to fetch it by asking /env (we didn't create it).
  // Instead we will require the GOOGLE_CLIENT_ID to be set as a meta tag by server; but simpler: ask user to set it in a JS variable below.
  return window.__GOOGLE_CLIENT_ID || '';
}

// Render the Google button
async function initGoogle(){
  const CLIENT_ID = await fetchClientId();
  if(!CLIENT_ID){
    document.getElementById('auth-msg').innerText = 'Google Client ID not configured on server. Set GOOGLE_CLIENT_ID env var.';
    return;
  }

  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: handleCredentialResponse
  });
  window.google.accounts.id.renderButton(
    document.getElementById('googleBtn'),
    { theme: 'outline', size: 'large' } // customization
  );
}

async function handleCredentialResponse(response){
  // response.credential is the ID token
  const id_token = response.credential;
  const res = await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token})});
  const j = await res.json();
  if (j.token) {
    token = j.token;
    afterLogin(j.email);
  } else {
    document.getElementById('auth-msg').innerText = j.error || 'Auth failed';
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  // try to fetch GOOGLE_CLIENT_ID from server-injected window variable
  // If you want, server can inject it by templating index.html; for now put it manually:
  // e.g. in browser console: window.__GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
  await initGoogle();
});

// called after successful login
async function afterLogin(email){
  document.getElementById('auth').style.display='none';
  document.getElementById('main').style.display='block';
  document.getElementById('welcome').innerText = 'Welcome, ' + email;
  loadWinner();
}

// load today's winner
async function loadWinner(){
  const j = await api('/winner/latest');
  if(j.winner){
    const w = j.winner;
    document.getElementById('today-winner').innerText = w.winner_email ? `${w.winner_email} (date: ${w.winner_date})` : 'No winner yet';
  } else document.getElementById('today-winner').innerText = 'No winner yet';
}

/* SPINNING ANIMATION */
const spinBtn = document.getElementById('spinBtn');
const wheel = document.getElementById('wheel');
const SECTORS = 8; // must match backend sectors length

function sectorToAngle(index){
  // sectors laid out clockwise; we want the wheel to stop so that the chosen sector lands at top-pointer
  const sectorSize = 360 / SECTORS;
  // compute random offset inside sector to make it look natural
  const offset = Math.random() * (sectorSize - 6) - (sectorSize/2 - 3);
  const target = 360 - (index * sectorSize + sectorSize/2) + offset;
  return target;
}

let currentRotation = 0;

spinBtn.onclick = async ()=>{
  spinBtn.disabled = true;
  document.getElementById('spin-result').innerText = 'Spinning...';
  const res = await api('/spin',{method:'POST'});
  if(res.error){
    document.getElementById('spin-result').innerText = res.error;
    spinBtn.disabled = false;
    return;
  }
  const idx = (typeof res.sectorIndex === 'number') ? res.sectorIndex : (res.result === 'GIFT' ? 7 : 0);
  const spinCount = 6 + Math.floor(Math.random()*4); // full rotations
  const targetAngle = spinCount*360 + sectorToAngle(idx);

  // animate with CSS transition
  currentRotation = currentRotation % 360;
  const finalRotation = currentRotation + targetAngle;
  wheel.style.transition = 'transform 4s cubic-bezier(.2,.9,.2,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  // when transition ends show result
  wheel.addEventListener('transitionend', function handler(){
    wheel.style.transition = ''; // clear for future spins
    currentRotation = finalRotation % 360;
    wheel.removeEventListener('transitionend', handler);
    const r = res.result;
    if(r === 'GIFT'){
      document.getElementById('spin-result').innerText = '🎉 You landed on: Chance to win Free Gift coupon! If selected you may win ₹250.';
    } else {
      document.getElementById('spin-result').innerText = 'Try Again!';
    }
    loadWinner();
    spinBtn.disabled = false;
  });
};
