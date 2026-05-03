require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { clerkMiddleware } = require('@clerk/express');
const { initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS — locked to allowed origins (set ALLOWED_ORIGINS in .env for production)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json());
app.use(clerkMiddleware());
app.use(express.static(path.join(__dirname, 'public')));

// Serve Clerk browser bundle from node_modules
const clerkBundlePath = path.join(__dirname, 'node_modules/@clerk/clerk-js/dist/clerk.browser.js');
app.get('/clerk.browser.js', (req, res) => {
  res.sendFile(clerkBundlePath, (err) => {
    if (err) res.status(404).json({ error: 'clerk-js not installed. Run: npm install @clerk/clerk-js' });
  });
});

// API Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/downloads', require('./routes/downloads'));
app.use('/api/admin',     require('./routes/admin'));

// Named page routes
app.get('/dashboard',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/login',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/sso-callback', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sso-callback.html')));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Boot
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log('\n  Viddly running at http://localhost:' + PORT);
      console.log('  Press Ctrl+C to stop\n');
    });
  })
  .catch((err) => {
    console.error('Failed to connect to database:', err.message);
    process.exit(1);
  });
