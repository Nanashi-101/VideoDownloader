const express = require('express');
const { clerkClient } = require('@clerk/express');
const { query } = require('../db');
const { adminProtect } = require('../middleware/auth');

const router = express.Router();
router.use(adminProtect);

// GET /api/admin/users  — merges Clerk profile data
router.get('/users', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
    // Enrich with Clerk email/username
    const enriched = await Promise.all(rows.map(async (u) => {
      try {
        const cu = await clerkClient.users.getUser(u.id);
        return {
          ...u,
          email:    cu.emailAddresses[0]?.emailAddress || '',
          username: cu.username || cu.firstName || u.id
        };
      } catch {
        return { ...u, email: '', username: u.id };
      }
    }));
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role))
    return res.status(400).json({ error: 'Role must be "user" or "admin"' });
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Cannot change your own role' });
  await query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
  res.json({ message: 'Role updated' });
});

// PUT /api/admin/users/:id/active
router.put('/users/:id/active', async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Cannot disable your own account' });
  const { is_active } = req.body;
  await query('UPDATE users SET is_active=$1 WHERE id=$2', [is_active, req.params.id]);
  res.json({ message: is_active ? 'Account enabled' : 'Account disabled' });
});

// GET /api/admin/downloads
router.get('/downloads', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.id AS clerk_id FROM downloads d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC`
  );
  res.json(rows);
});

// DELETE /api/admin/downloads/:id
router.delete('/downloads/:id', async (req, res) => {
  await query('DELETE FROM downloads WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const [statusRes, userRes, dlRes] = await Promise.all([
    query('SELECT status, COUNT(*) AS count FROM downloads GROUP BY status'),
    query('SELECT COUNT(*) AS count FROM users'),
    query('SELECT COUNT(*) AS count FROM downloads')
  ]);
  const by_status = {};
  for (const row of statusRes.rows) by_status[row.status] = parseInt(row.count);
  res.json({
    total_users:     parseInt(userRes.rows[0].count),
    total_downloads: parseInt(dlRes.rows[0].count),
    by_status
  });
});

module.exports = router;
