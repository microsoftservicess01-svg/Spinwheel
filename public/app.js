let token = null;
const api = (path, opts={}) =>
  fetch('/api'+path, {
    ...opts,
    headers: token ? { ...opts.headers, Authorization: 'Bearer '+token } : opts.headers,
  }).then(r=>r.json());

// Registration
document.getElementById('registerBtn').onclick = async ()=>{
  const password = document.getElementById('regPassword').value;
  document.getElementById('reg-msg').innerText = 'Registering...';

  const res = await api('/register',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password})
  });
  
  if(res.token){
    token = res.token;
    document.getElementById('reg-msg').innerText = 
      'Registered! Your Unique ID: ' + res.unique_id;
    afterLogin(res.unique_id);
  } else {
    document.getElementById('reg-msg').innerText = res.error;
  }
};

// Login
document.getElementById('loginBtn').onclick = async ()=>{
  const unique_id = document.getElementById('loginUniqueId').value;
  const password = document.getElementById('loginPassword').value;

  const res = await api('/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({unique_id,password})
  });
  
  if(res.token){
    token = res.token;
    afterLogin(res.unique_id);
  } else {
    document.getElementById('login-msg').innerText = res.error;
  }
};

function afterLogin(uid){
  document.getElementById('auth').style.display='none';
  document.getElementById('main').style.display='block';
  document.getElementById('welcome').innerText = 'Welcome, ' + uid;
  loadWinner();
}

async function loadWinner(){
  const j = await api('/winner/latest');
  document.getElementById('today-winner').innerText =
    j?.winner?.winner_unique_id 
      ? `${j.winner.winner_unique_id} (date: ${j.winner.winner_date})`
      : "No winner yet";
}

/* SPIN ANIMATION */

const wheel = document.getElementById('wheel');
const spinBtn = document.getElementById('spinBtn');
const SECTORS = 8;

let currentRotation = 0;

function sectorToAngle(index){
  const size = 360 / SECTORS;
  const rand = (Math.random()*14)-7;
  return 360 - (index * size + size/2) + rand;
}

spinBtn.onclick = async ()=>{
  spinBtn.disabled=true;
  document.getElementById('spin-result').innerText="Spinning...";

  const res = await api('/spin',{method:'POST'});
  if(res.error){
    document.getElementById('spin-result').innerText = res.error;
    spinBtn.disabled=false;
    return;
  }

  const idx = res.sectorIndex;
  const fullTurns = 6 + Math.floor(Math.random()*4);
  const target = fullTurns*360 + sectorToAngle(idx);

  currentRotation = currentRotation % 360;
  const final = currentRotation + target;

  wheel.style.transition = "transform 4s cubic-bezier(.2,.9,.2,1)";
  wheel.style.transform = `rotate(${final}deg)`;

  wheel.addEventListener("transitionend", function handler(){
    wheel.removeEventListener("transitionend", handler);
    wheel.style.transition = "";
    currentRotation = final % 360;

    document.getElementById('spin-result').innerText =
      res.result === "GIFT"
        ? "🎉 You landed on the gift coupon chance!"
        : "Try Again!";

    loadWinner();
    spinBtn.disabled=false;
  });
};
