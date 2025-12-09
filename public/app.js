  /* ----------------------------
     Winner registration helper (paste INSIDE DOMContentLoaded)
     - Shows email prompt after correct answer (no validation)
     - POSTs to /api/register-winner and shows returned code overlay
     - Listens for `correctAnswer` custom event
     Usage: dispatch on correct answer:
       document.dispatchEvent(new CustomEvent('correctAnswer'));
     ---------------------------- */
  (function () {
    // prevent double-injection
    if (window.__winnerModuleInstalled) return;
    window.__winnerModuleInstalled = true;

    function ensureWinnerDOM() {
      if (document.getElementById('winner-register')) return;

      const wrapper = document.createElement('div');
      wrapper.id = 'winner-register';
      wrapper.style.display = 'none';
      wrapper.style.padding = '12px';
      wrapper.style.maxWidth = '520px';
      wrapper.style.margin = '10px auto';

      wrapper.innerHTML = `
        <div style="background:#fff;padding:12px;border-radius:10px;color:#0b1220;">
          <p style="font-weight:700;margin:0 0 8px 0;">Correct! Claim entry for today's voucher draw</p>
          <label for="winner-email" style="display:block;margin-bottom:6px;font-weight:600;">Enter your email (no validation required)</label>
          <input id="winner-email" type="email" placeholder="you@example.com" style="width:100%;max-width:360px;padding:10px;border-radius:6px;border:1px solid #ddd" />
          <div style="height:10px;"></div>
          <button id="winner-submit-btn" style="padding:10px 14px;background:#ff5ca8;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer;">
            Register & Get Unique Code
          </button>
          <p id="winner-msg" style="margin-top:10px;display:none;"></p>
        </div>
      `;

      // Append into body (or change selector to a specific container in your quiz page)
      document.body.appendChild(wrapper);
    }

    function showCodeOverlay(code) {
      if (document.getElementById('winner-overlay')) return;

      const popupHtml = `
        <div style="padding:18px;border-radius:10px;background:#fff;color:#0b1220;max-width:420px;margin:auto;text-align:left;">
          <h3 style="margin-top:0;">Your registration is complete</h3>
          <p style="font-size:18px;font-weight:800;margin:10px 0;">Unique Code: <span style="background:#f0f0f0;padding:6px;border-radius:6px;">${code}</span></p>
          <p style="margin-top:8px;">Please take a screenshot of this code and keep it safe. If you are selected for today’s voucher, present this code to claim it.</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
            <button id="copy-code-btn" style="padding:8px 10px;border-radius:8px;background:#0b1220;color:#fff;border:0;cursor:pointer">Copy Code</button>
            <button id="popup-close" style="padding:8px 10px;border-radius:8px;background:#777;color:#fff;border:0;cursor:pointer">Close</button>
          </div>
        </div>
      `;

      const overlay = document.createElement('div');
      overlay.id = 'winner-overlay';
      overlay.style.position = 'fixed';
      overlay.style.left = 0;
      overlay.style.top = 0;
      overlay.style.right = 0;
      overlay.style.bottom = 0;
      overlay.style.background = 'rgba(0,0,0,0.6)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = 999999;
      overlay.innerHTML = popupHtml;
      document.body.appendChild(overlay);

      document.getElementById('popup-close').addEventListener('click', () => {
        overlay.remove();
      });

      document.getElementById('copy-code-btn').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          document.getElementById('copy-code-btn').textContent = 'Copied';
        } catch (e) {
          document.getElementById('copy-code-btn').textContent = 'Copy Failed';
        }
      });
    }

    // expose function to trigger (call this after correct answer)
    window.promptForWinnerEmail = function promptForWinnerEmail() {
      ensureWinnerDOM();
      const wrapper = document.getElementById('winner-register');
      const emailInput = document.getElementById('winner-email');
      const submitBtn = document.getElementById('winner-submit-btn');
      const msgP = document.getElementById('winner-msg');

      wrapper.style.display = 'block';
      msgP.style.display = 'none';

      if (submitBtn.__winnerBound) return;
      submitBtn.__winnerBound = true;

      submitBtn.addEventListener('click', async () => {
        const email = (emailInput.value || '').trim(); // no validation required

        submitBtn.disabled = true;
        submitBtn.textContent = 'Registering...';
        msgP.style.display = 'none';

        try {
          const res = await fetch('/api/register-winner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await res.json();
          if (!res.ok || !data || data.ok !== true) {
            msgP.style.display = 'block';
            msgP.style.color = 'crimson';
            msgP.textContent = (data && data.error) ? data.error : 'Registration failed, please try again';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register & Get Unique Code';
            return;
          }

          const code = data.code || '';
          showCodeOverlay(code);

          msgP.style.display = 'block';
          msgP.style.color = 'green';
          msgP.textContent = 'Registered — unique code displayed. Please screenshot it.';
          submitBtn.style.display = 'none';
          emailInput.disabled = true;
        } catch (err) {
          msgP.style.display = 'block';
          msgP.style.color = 'crimson';
          msgP.textContent = 'Network error — try again';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Register & Get Unique Code';
        }
      });
    };

    // listen for a custom event from quiz page or other scripts
    // Usage: document.dispatchEvent(new CustomEvent('correctAnswer'));
    document.addEventListener('correctAnswer', () => {
      try { window.promptForWinnerEmail(); } catch(e){ console.error(e); }
    });

    // also listen for a direct call from other parts of this script
    // e.g., if your quiz code can call parent function, it can call window.promptForWinnerEmail()
  })();
