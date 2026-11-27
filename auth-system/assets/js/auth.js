/* auth.js — Client-side UX + synchronized validation with server password policy */
(() => {
  'use strict';

  const track        = document.getElementById('formsTrack');
  const switcher     = document.getElementById('tabSwitcher');
  const loginTabBtn  = document.getElementById('loginTabBtn');
  const regTabBtn    = document.getElementById('registerTabBtn');
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  if (!track || !switcher) return;

  function switchMode(mode) {
    const isReg = mode === 'register';

    track.classList.toggle('show-register', isReg);
    switcher.classList.toggle('is-register', isReg);
    loginTabBtn?.classList.toggle('is-active', !isReg);
    regTabBtn?.classList.toggle('is-active',   isReg);
    loginTabBtn?.setAttribute('aria-selected',  String(!isReg));
    regTabBtn?.setAttribute('aria-selected',    String(isReg));

    loginForm?.querySelectorAll('input,select,button,textarea')
      .forEach(el => { el.tabIndex = isReg ? -1 : 0; });
    registerForm?.querySelectorAll('input,select,button,textarea')
      .forEach(el => { el.tabIndex = isReg ? 0 : -1; });

    setTimeout(() => {
      const form = isReg ? registerForm : loginForm;
      form?.querySelector('input')?.focus();
    }, 380);
  }

  switchMode(track.classList.contains('show-register') ? 'register' : 'login');

  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.target));
  });

  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.toggle);
      if (!inp) return;
      const reveal = inp.type === 'password';
      inp.type = reveal ? 'text' : 'password';
      btn.textContent = reveal ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', (reveal ? 'Hide' : 'Show') + ' password');
    });
  });

  const regPw   = document.getElementById('regPassword');
  const fillEl  = document.getElementById('pwStrengthFill');
  const labelEl = document.getElementById('pwStrengthLabel');

  const levels = [
    { pct: 0,   color: '',        label: 'Requires 8+ chars with uppercase, lowercase, number, and symbol' },
    { pct: 20,  color: '#ef4444', label: 'Very weak' },
    { pct: 40,  color: '#f97316', label: 'Weak' },
    { pct: 65,  color: '#eab308', label: 'Fair' },
    { pct: 85,  color: '#22c55e', label: 'Strong' },
    { pct: 100, color: '#10b981', label: 'Very strong' },
  ];

  function scorePassword(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)           score++;
    if (/[A-Z]/.test(pw))         score++;
    if (/[a-z]/.test(pw))         score++;
    if (/[0-9]/.test(pw))         score++;
    if (/[^A-Za-z0-9]/.test(pw))  score++;
    return score;
  }

  function validateStrongPassword(pw) {
    if (pw.length < 8 || pw.length > 72) return 'Password must be 8–72 characters.';
    if (!/[A-Z]/.test(pw)) return 'Include at least one uppercase letter.';
    if (!/[a-z]/.test(pw)) return 'Include at least one lowercase letter.';
    if (!/[0-9]/.test(pw)) return 'Include at least one number.';
    if (!/[^A-Za-z0-9]/.test(pw)) return 'Include at least one special character.';
    return '';
  }

  regPw?.addEventListener('input', () => {
    const score = scorePassword(regPw.value);
    const level = levels[score] || levels[0];
    if (fillEl)  { fillEl.style.width = level.pct + '%'; fillEl.style.background = level.color; }
    if (labelEl) {
      labelEl.textContent = level.label;
      labelEl.style.color = level.color || 'var(--text-muted)';
    }
  });

  function setError(input, msg) {
    const field = input.closest('.field');
    const err   = field?.querySelector('.field-error');
    field?.classList.toggle('has-error', Boolean(msg));
    if (err) err.textContent = msg ? ('⚠ ' + msg) : '';
  }

  document.querySelectorAll('.auth-form input, .auth-form select').forEach(el => {
    el.addEventListener('input',  () => setError(el, ''));
    el.addEventListener('change', () => setError(el, ''));
  });

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  }

  loginForm?.addEventListener('submit', e => {
    let valid = true;
    const em = document.getElementById('loginEmail');
    const pw = document.getElementById('loginPassword');

    if (!validEmail(em.value)) { setError(em, 'Enter a valid email address.'); valid = false; }
    if (!pw.value)             { setError(pw, 'Password is required.');      valid = false; }
    if (!valid) { e.preventDefault(); return; }

    const btn = loginForm.querySelector('.btn-primary');
    btn?.classList.add('is-loading');
    btn?.setAttribute('disabled', '');
  });

  registerForm?.addEventListener('submit', e => {
    let valid = true;
    const nm = document.getElementById('regName');
    const em = document.getElementById('regEmail');
    const pw = document.getElementById('regPassword');
    const rl = document.getElementById('regRole');

    if (nm.value.trim().length < 2) {
      setError(nm, 'Full name must be at least 2 characters.'); valid = false;
    }
    if (!validEmail(em.value)) {
      setError(em, 'Enter a valid email address.'); valid = false;
    }
    const pwErr = validateStrongPassword(pw.value);
    if (pwErr) {
      setError(pw, pwErr); valid = false;
    }
    if (!['user', 'admin'].includes(rl.value)) {
      setError(rl, 'Please select a role.'); valid = false;
    }
    if (!valid) { e.preventDefault(); return; }

    const btn = registerForm.querySelector('.btn-primary');
    btn?.classList.add('is-loading');
    btn?.setAttribute('disabled', '');
  });

  const alertEl = document.querySelector('.alert');
  if (alertEl) {
    setTimeout(() => {
      alertEl.style.transition = 'opacity 0.5s ease';
      alertEl.style.opacity    = '0';
      setTimeout(() => alertEl.remove(), 500);
    }, 6000);
  }
})();
