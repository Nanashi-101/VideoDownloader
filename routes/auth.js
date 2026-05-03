const express = require('express');
const { clerkClient, getAuth } = require('@clerk/express');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkUser = await clerkClient.users.getUser(auth.userId);
    const email       = clerkUser.emailAddresses[0]?.emailAddress || '';
    const displayName = clerkUser.fullName
                     || clerkUser.firstName
                     || clerkUser.username
                     || email.split('@')[0]
                     || clerkUser.id;
    const username    = clerkUser.username || displayName;
    const imageUrl    = clerkUser.imageUrl || null;
    res.json({
      id:          req.user.id,
      email,
      username,
      displayName,
      imageUrl,
      role:        req.user.role,
      created_at:  req.user.created_at
    });
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

module.exports = router;
