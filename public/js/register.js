function show(id) {
  ['view-loading','view-form','view-verify'].forEach(v => {
    document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
  });
}

function setError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

let signUpAttempt = null;

async function signUpWith(strategy) {
  try {
    await window.Clerk.client.signIn.authenticateWithRedirect({
      strategy,
      redirectUrl: window.location.origin + '/sso-callback',
      redirectUrlComplete: '/dashboard',
    });
  } catch (err) {
    setError('global-error', err.errors?.[0]?.message || 'OAuth sign-up failed.');
  }
}

(async () => {
  await window.Clerk.load();
  if (window.Clerk.user) { window.location.href = '/dashboard'; return; }
  show('view-form');
})();

// Step 1 — create account
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('global-error', '');
  const email     = document.getElementById('email').value.trim();
  const password  = document.getElementById('password').value;
  const password2 = document.getElementById('password2').value;
  const btn       = document.getElementById('submit-btn');

  if (!email || !password) { setError('global-error', 'Please fill in all fields.'); return; }
  if (password !== password2) { setError('global-error', 'Passwords do not match.'); return; }
  if (password.length < 8)   { setError('global-error', 'Password must be at least 8 characters.'); return; }

  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    signUpAttempt = await window.Clerk.client.signUp.create({ emailAddress: email, password });
    await signUpAttempt.prepareEmailAddressVerification({ strategy: 'email_code' });
    document.getElementById('verify-email').textContent = email;
    show('view-verify');
  } catch (err) {
    console.error('[Clerk] sign-up error:', err);
    const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Sign-up failed.';
    setError('global-error', msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});

// Step 2 — verify email code
document.getElementById('verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('verify-error', '');
  const code = document.getElementById('code').value.trim();
  const btn  = document.getElementById('verify-btn');
  if (!code) { setError('verify-error', 'Please enter the code.'); return; }

  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    const result = await signUpAttempt.attemptEmailAddressVerification({ code });
    if (result.status === 'complete') {
      await window.Clerk.setActive({ session: result.createdSessionId });
      window.location.href = '/dashboard';
    } else {
      setError('verify-error', 'Verification incomplete. Please try again.');
    }
  } catch (err) {
    console.error('[Clerk] verify error:', err);
    const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Invalid code.';
    setError('verify-error', msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify & continue';
  }
});
