/* ---------- Winner email prompt & submit flow ----------
   - Call promptForWinnerEmail() when the user answers correctly.
   - No client-side email validation (per request).
   - Posts { email } to /api/register-winner, shows returned code in overlay.
--------------------------------------------------------- */
(function () {
  if (window.__registerWinnerUiInstalled) return;
  window.__registerWinnerUiInstalled = true;

  // build modal DOM and append to body (hidden)
  function buildWinnerModal() {
    if (document.getElementById('winner-register-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'winner-register-modal';
    modal.style.position = 'fixed';
    modal.style.left = 0;
    modal.style.top = 0;
    modal.style.right = 0;
    modal.style.bottom = 0;
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.background = 'rgba(0,0,0,0.6)';
    modal.style.zIndex = 999999;

    modal.innerHTML = `
      <div style="width:100%;max-width:520px;background:#fff;border-radius:12px;padding:18px;color:#0b1220;">
        <h3 style="margin-top:0">Claim entry for today's voucher draw</h3>
        <p style="margin:6px 0 12px 0">Enter your email below (no validation required). We'll generate a unique code — take a screenshot to claim if you win.</p>
        <input id="winner-email-input" type="email" placeholder="you@example.com" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box" />
        <div style="height:12px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="winner-submit-btn" style="background:#2874f0;color:#fff;border:0;padding:10px 12px;border-radius:8px;font-weight:700;cursor:pointer;">Register & Get Code</button>
          <button id="winner-cancel-btn" style="background:#ddd;color:#000;border:0;padding:10px 12px;border-radius:8px;cursor:pointer;">Cancel</button>
        </div>
        <p id="winner-feedback" style="margin-top:10px;display:none;"></p>
      </div>
    `;
    document.body.appendChild(modal);

    // handlers
    document.getElementById('winner-cancel-btn').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // show overlay with the returned code
  function showCodeOverlay(code) {
    // remove existing overlay if any
    const existing = document.getElementById('winner-code-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'winner-code-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = 0;
    overlay.style.top = 0;
    overlay.style.right = 0;
    overlay.style.bottom = 0;
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = 1000000;

    overlay.innerHTML = `
      <div style="width:100%;max-width:520px;background:#fff;border-radius:12px;padding:18px;color:#0b1220;">
        <h3 style="margin-top:0">You're registered</h3>
        <p style="font-size:18px;margin:10px 0;font-weight:800;">Unique Code: <span style="background:#f0f0f0;padding:6px;border-radius:6px;">${code}</span></p>
        <p style="margin-top:6px;">Please take a screenshot of this code. If you win, present this code to claim your voucher.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button id="copy-code-btn" style="padding:8px 10px;border-radius:8px;background:#0b1220;color:#fff;border:0;cursor:pointer">Copy</button>
          <button id="close-code-btn" style="padding:8px 10px;border-radius:8px;background:#ddd;color:#000;border:0;cursor:pointer">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('close-code-btn').addEventListener('click', () => overlay.remove());
    document.getElementById('copy-code-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        document.getElementById('copy-code-btn').textContent = 'Copied';
      } catch (e) {
        document.getElementById('copy-code-btn').textContent = 'Copy failed';
      }
    });
  }

  // main call: shows modal and wires up submit to call backend
  window.promptForWinnerEmail = async function promptForWinnerEmail() {
    buildWinnerModal();
    const modal = document.getElementById('winner-register-modal');
    const input = document.getElementById('winner-email-input');
    const submit = document.getElementById('winner-submit-btn');
    const feedback = document.getElementById('winner-feedback');

    input.value = '';
    feedback.style.display = 'none';
    submit.disabled = false;
    submit.textContent = 'Register & Get Code';
    modal.style.display = 'flex';
    input.focus();

    // avoid double-binding
    if (submit.__registered) return;
    submit.__registered = true;

    submit.addEventListener('click', async () => {
      const email = (input.value || '').trim(); // no validation per request
      submit.disabled = true;
      submit.textContent = 'Registering...';
      feedback.style.display = 'none';

      try {
        const res = await fetch('/api/register-winner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok || !data || !data.ok) {
          feedback.style.display = 'block';
          feedback.style.color = 'crimson';
          feedback.textContent = (data && data.error) ? data.error : 'Registration failed';
          submit.disabled = false;
          submit.textContent = 'Register & Get Code';
          return;
        }

        modal.style.display = 'none';
        showCodeOverlay(data.code || '');
      } catch (err) {
        feedback.style.display = 'block';
        feedback.style.color = 'crimson';
        feedback.textContent = 'Network error — try again';
        submit.disabled = false;
        submit.textContent = 'Register & Get Code';
      }
    });
  };
})();
