function show(id) {
  ['view-loading','view-form'].forEach(v => {
    document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
  });
}

function setGlobalError(msg) {
  const el = document.getElementById('global-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function signInWith(strategy) {
  try {
    await window.Clerk.client.signIn.authenticateWithRedirect({
      strategy,
      redirectUrl: window.location.origin + '/sso-callback',
      redirectUrlComplete: '/dashboard',
    });
  } catch (err) {
    setGlobalError(err.errors?.[0]?.message || 'OAuth sign-in failed.');
  }
}

(async () => {
  await window.Clerk.load();
  if (window.Clerk.user) { window.location.href = '/dashboard'; return; }
  show('view-form');
})();

document.getElementById('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setGlobalError('');
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('submit-btn');

  if (!email || !password) { setGlobalError('Please fill in all fields.'); return; }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const result = await window.Clerk.client.signIn.create({ identifier: email, password });
    if (result.status === 'complete') {
      await window.Clerk.setActive({ session: result.createdSessionId });
      window.location.href = '/dashboard';
    } else {
      setGlobalError('Additional verification required. Please check your email.');
    }
  } catch (err) {
    console.error('[Clerk] sign-in error:', err);
    const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Sign-in failed. Please try again.';
    setGlobalError(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});
