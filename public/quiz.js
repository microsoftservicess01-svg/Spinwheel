document.addEventListener('DOMContentLoaded', async () => {
  function generateId() { return 'c-' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }
  let client_id = localStorage.getItem('lucky_client_id');
  if (!client_id) { client_id = generateId(); localStorage.setItem('lucky_client_id', client_id); }

  const questionArea = document.getElementById('questionArea');

  async function api(path, opts={}) {
    try {
      const headers = opts.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      const res = await fetch('/api'+path, Object.assign({}, opts, { headers }));
      const text = await res.text();
      try { return { ok: res.ok, body: text?JSON.parse(text):null, status: res.status }; } catch(e){ return { ok: res.ok, body: text, status: res.status }; }
    } catch(e) { console.error('Network error', e); return { ok:false, body:{ error:'Network error' } }; }
  }

  const qres = await api('/quiz/all');
  if (!qres.ok) { questionArea.innerText = 'Unable to load quiz. Try later.'; return; }
  const questions = qres.body.questions || [];
  if (!questions.length) { questionArea.innerText = 'No questions available today.'; return; }

  const q = questions[Math.floor(Math.random()*questions.length)];
  function render(q) {
    const html = ['<div><h3>Question</h3>','<p>'+q.question+'</p>','<div id="opts">'];
    q.options.forEach((opt,oi)=> html.push('<div><button class="optBtn" data-qid="'+q.id+'" data-idx="'+oi+'">'+String.fromCharCode(65+oi)+'. '+opt+'</button></div>'));
    html.push('</div><div id="msg" style="margin-top:12px;color:green"></div>');
    questionArea.innerHTML = html.join('');
    document.querySelectorAll('.optBtn').forEach(b=>b.addEventListener('click', submit));
  }
  async function submit(ev) {
    const btn = ev.currentTarget;
    const qid = Number(btn.getAttribute('data-qid'));
    const sel = Number(btn.getAttribute('data-idx'));
    document.querySelectorAll('.optBtn').forEach(b=>b.disabled=true);
    const payload = { client_id, question_id: qid, selected_index: sel };
    const r = await api('/quiz/submit', { method:'POST', body: JSON.stringify(payload) });
    const msg = document.getElementById('msg');
    if (!r.ok) {
      msg.style.color='red';
      msg.innerText = r.body?.error || 'Submission failed';
      return;
    }
    const body = r.body;
    if (body.correct) {
      msg.style.color='green';
      msg.innerHTML = body.message + (body.quiz_id ? ('<br><strong>Your Quiz ID: '+body.quiz_id+'</strong>') : '');
    } else {
      msg.style.color='orange';
      msg.innerText = body.message || 'Incorrect. You used your one attempt for today.';
    }
  }
  render(q);
});
