const { getAuth } = require('@clerk/express');
const { query } = require('../db');

// Move ?token= query param to Authorization header (needed for <video src="?token=..."> streaming)
function tokenFromQuery(req, res, next) {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

// Upsert user in our DB on first login. First user ever becomes admin.
async function ensureUser(clerkUserId) {
  const countRes = await query('SELECT COUNT(*) AS count FROM users');
  const isFirst  = parseInt(countRes.rows[0].count) === 0;
  const role     = isFirst ? 'admin' : 'user';
  await query(
    `INSERT INTO users (id, role) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [clerkUserId, role]
  );
  const res = await query('SELECT * FROM users WHERE id = $1', [clerkUserId]);
  return res.rows[0];
}

// Verify Clerk token, upsert user, attach to req.user
async function attachUser(req, res, next) {
  try {
    const auth = getAuth(req);
    console.log('[DEBUG] Auth Headers:', req.headers.authorization ? 'Present' : 'Missing');
    console.log('[DEBUG] Request keys:', Object.keys(req).filter(k => k.includes('auth') || k.includes('clerk')));
    console.log('[DEBUG] Clerk Auth Object:', JSON.stringify(auth, null, 2));
    if (req.auth) console.log('[DEBUG] req.auth:', JSON.stringify(req.auth, null, 2));
    
    const userId = auth.userId || (req.auth && req.auth.userId);
    
    if (!userId) {
      console.warn('[WARN] No userId found in Clerk auth state');
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const user = await ensureUser(userId);
    if (!user.is_active) return res.status(403).json({ error: 'Account is disabled' });
    req.user = user;
    next();
  } catch (err) {
    console.error('attachUser error:', err);
    res.status(500).json({ error: 'Auth error' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Middleware chains
const { requireAuth } = require('@clerk/express');
const protect      = [tokenFromQuery, requireAuth(), attachUser];
const adminProtect = [tokenFromQuery, requireAuth(), attachUser, requireAdmin];

module.exports = { protect, adminProtect, requireAdmin, attachUser, tokenFromQuery };
