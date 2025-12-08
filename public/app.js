let token = null;
const api = (path, opts={}) => fetch('/api'+path, Object.assign({headers: token?{Authorization:'Bearer '+token}:{}, credentials:'same-origin'}, opts)).then(r=>r.json());

document.getElementById('register').onclick = async ()=>{
  const email=document.getElementById('email').value; const password=document.getElementById('password').value;
  const res = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j = await res.json();
  if(j.token){ token=j.token; afterLogin(); } else { document.getElementById('auth-msg').innerText = (j.error||'Error'); }
}

document.getElementById('login').onclick = async ()=>{
  const email=document.getElementById('email').value; const password=document.getElementById('password').value;
  const res = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j = await res.json();
  if(j.token){ token=j.token; afterLogin(); } else { document.getElementById('auth-msg').innerText = (j.error||'Error'); }
}

async function afterLogin(){
  document.getElementById('auth').style.display='none';
  document.getElementById('main').style.display='block';
  const me = await api('/me');
  document.getElementById('welcome').innerText = 'Welcome, '+me.user.email;
  loadWinner();
}

async function loadWinner(){
  const j = await api('/winner/latest');
  if(j.winner){
    const w = j.winner;
    document.getElementById('today-winner').innerText = w.winner_email ? `${w.winner_email} (date: ${w.winner_date})` : 'No winner yet';
  } else document.getElementById('today-winner').innerText = 'No winner yet';
}

const spinBtn = document.getElementById('spinBtn');
spinBtn.onclick = async ()=>{
  spinBtn.disabled = true; document.getElementById('spin-result').innerText='Spinning...';
  const res = await api('/spin',{method:'POST'});
  if(res.error){ document.getElementById('spin-result').innerText = res.error; spinBtn.disabled=false; return; }
  const r = res.result;
  if(r === 'GIFT'){
    document.getElementById('spin-result').innerText = '🎉 You landed on: Chance to win Free Gift coupon! If you are selected in today\'s draw you will be announced as the lucky winner worth ₹250.';
  } else {
    document.getElementById('spin-result').innerText = 'Try Again!';
  }
  await loadWinner();
  spinBtn.disabled=false;
}
