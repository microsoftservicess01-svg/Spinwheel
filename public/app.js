document.addEventListener('DOMContentLoaded', () => {
  function generateId() { return 'c-' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }
  let client_id = localStorage.getItem('lucky_client_id');
  if (!client_id) { client_id = generateId(); localStorage.setItem('lucky_client_id', client_id); }
  const clientInfo = document.getElementById('clientInfo');
  if (clientInfo) clientInfo.innerText = 'Your device id: ' + client_id + ' (stored locally)';

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
  const SECTORS = 8;
  let currentRotation = 0;

  function sectorToAngle(index){
    const size = 360 / SECTORS;
    const rand = (Math.random()*14)-7;
    return 360 - (index * size + size/2) + rand;
  }

  async function loadWinner(){
    const r = await api('/winner/latest');
    if (!r.ok) { todayWinnerEl.innerText = 'Unable to load winner'; return; }
    const w = r.body.winner;
    if (w && w.winner_client_id) todayWinnerEl.innerText = w.winner_client_id + ' (date: ' + w.winner_date + ')';
    else todayWinnerEl.innerText = 'No winner yet';
  }

  spinBtn.addEventListener('click', async () => {
    spinBtn.disabled = true;
    spinResultEl.innerText = 'Spinning...';
    const r = await api('/spin', { method:'POST', body: JSON.stringify({ client_id }) });
    if (!r.ok) { spinResultEl.innerText = r.body?.error || 'Spin failed'; spinBtn.disabled=false; return; }
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
      if (body.result === 'GIFT') spinResultEl.innerText = '🎉 You landed on Gift Chance! Entered into today\'s draw for ₹250.';
      else spinResultEl.innerText = 'Try Again!';
      loadWinner();
      spinBtn.disabled=false;
    });
  });

  loadWinner();
});
