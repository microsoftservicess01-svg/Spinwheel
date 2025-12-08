// public/app.js - wheel with visible sector labels (Try Again x7 + Lucky)
document.addEventListener('DOMContentLoaded', () => {
  // helper: client id
  function generateId() { return 'c-' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }
  let client_id = localStorage.getItem('lucky_client_id');
  if (!client_id) { client_id = generateId(); localStorage.setItem('lucky_client_id', client_id); }
  const clientInfo = document.getElementById('clientInfo');
  if (clientInfo) clientInfo.innerText = 'Your device id: ' + client_id + ' (stored locally)';

  // api helper
  const api = async (path, opts={}) => {
    try {
      const headers = opts.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      const res = await fetch('/api'+path, Object.assign({}, opts, { headers }));
      const text = await res.text();
      try { return { ok: res.ok, body: text?JSON.parse(text):null, status: res.status }; } catch(e){ return { ok: res.ok, body: text, status: res.status }; }
    } catch(e) { console.error('Network error', e); return { ok:false, body:{ error:'Network error' } }; }
  };

  const wheel = document.getElementById('wheel');
  const spinBtn = document.getElementById('spinBtn');
  const spinResultEl = document.getElementById('spin-result');
  const todayWinnerEl = document.getElementById('today-winner');
  const luckyAction = document.getElementById('lucky-action');

  // sector definitions (length must match backend sectors length = 8)
  const SECTORS = 8;
  // 7 Try Again, 1 Lucky — index of Lucky we want to match backend random (backend uses array with GIFT at last index)
  const sectors = ['Try Again','Try Again','Try Again','Try Again','Try Again','Try Again','Try Again','Lucky'];

  // draw labels around the wheel
  function drawSectorLabels() {
    const labelsContainer = document.getElementById('sector-labels');
    labelsContainer.innerHTML = '';
    const centerX = 130; // relative to wheel left (wheel is 260px)
    const centerY = 130;
    const radius = 140; // distance from center
    for (let i=0;i<SECTORS;i++){
      const angle = (360/SECTORS)*i - (360/SECTORS)/2; // align labels with sectors
      const rad = angle * Math.PI/180;
      const x = centerX + radius * Math.cos(rad);
      const y = centerY + radius * Math.sin(rad);
      const el = document.createElement('div');
      el.className = 'sector-label';
      el.style.left = (x) + 'px';
      el.style.top = (y) + 'px';
      el.innerText = sectors[i];
      labelsContainer.appendChild(el);
    }
  }

  // place labels initially
  drawSectorLabels();

  // keep rotation state
  let currentRotation = 0;
  function sectorToAngle(index){
    const size = 360 / SECTORS;
    const rand = (Math.random()*12)-6;
    // rotate so that index lands under the pointer at top (0deg)
    // pointer at top -> compute angle to rotate so chosen sector center reaches pointer
    return 360 - (index * size + size/2) + rand;
  }

  // load today's winner
  async function loadWinner(){
    const r = await api('/winner/latest');
    if (!r.ok) { todayWinnerEl.innerText = 'Unable to load winner'; return; }
    const w = r.body.winner;
    if (w && w.winner_client_id) todayWinnerEl.innerText = w.winner_client_id + ' (date: ' + w.winner_date + ')';
    else todayWinnerEl.innerText = 'No winner yet';
  }

  // spin handler
  spinBtn.addEventListener('click', async () => {
    spinBtn.disabled = true;
    spinResultEl.innerText = 'Spinning...';
    luckyAction.innerHTML = '';
    const r = await api('/spin', { method:'POST', body: JSON.stringify({ client_id }) });
    if (!r.ok) {
      spinResultEl.innerText = r.body?.error || 'Spin failed';
      spinBtn.disabled = false;
      return;
    }
    const body = r.body;
    const idx = typeof body.sectorIndex === 'number' ? body.sectorIndex : (body.result === 'GIFT' ? 7 : 0);
    const full = 6 + Math.floor(Math.random()*4);
    const target = full*360 + sectorToAngle(idx);

    currentRotation = currentRotation % 360;
    const final = currentRotation + target;
    wheel.style.transition = 'transform 4s cubic-bezier(.2,.9,.2,1)';
    wheel.style.transform = 'rotate('+final+'deg)';

    wheel.addEventListener('transitionend', function handler(){
      wheel.removeEventListener('transitionend', handler);
      wheel.style.transition = '';
      currentRotation = final % 360;

      // display result text based on server result value
      if (body.result === 'GIFT') {
        spinResultEl.innerText = '🎉 Lucky! You landed on the Lucky sector.';
        // show action to go to quiz (user can now attempt quiz)
        luckyAction.innerHTML = '<button id="goQuizBtn">Answer Quiz & Qualify (₹200)</button>';
        document.getElementById('goQuizBtn').addEventListener('click', ()=> window.location='/quiz.html');
      } else {
        spinResultEl.innerText = 'Try Again!';
        luckyAction.innerHTML = '';
      }
      loadWinner();
      spinBtn.disabled = false;
    });
  });

  loadWinner();
});
