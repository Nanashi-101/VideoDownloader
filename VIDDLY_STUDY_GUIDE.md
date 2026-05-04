# Viddly — Full Project Study Guide

A complete technical reference for understanding every layer of the Viddly codebase: architecture, APIs, auth, database, networking, and deployment.

---

## Table of Contents

1. [What Is Viddly?](#1-what-is-viddly)
2. [Tech Stack](#2-tech-stack)
3. [Project File Structure](#3-project-file-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Database Design](#5-database-design)
6. [Authentication — How Clerk Works](#6-authentication--how-clerk-works)
7. [API Reference — All Endpoints](#7-api-reference--all-endpoints)
8. [Backend Deep Dive](#8-backend-deep-dive)
9. [Frontend Pages](#9-frontend-pages)
10. [The Download Pipeline](#10-the-download-pipeline)
11. [Networking & CORS](#11-networking--cors)
12. [Deployment on Railway](#12-deployment-on-railway)
13. [Environment Variables](#13-environment-variables)
14. [Security Model](#14-security-model)
15. [Known Limitations & Future Work](#15-known-limitations--future-work)
16. [Supported Sites for yt-dlp](#16-supported-sites-for-yt-dlp)
17. [Glossary](#17-glossary)

---

## 1. What Is Viddly?

Viddly is a **full-stack web application** that lets authenticated users paste a video URL from any of 1,000+ supported websites and download it as an MP4 file — directly from a browser.

**Core features:**
- User sign-up and sign-in (email/password + Google OAuth)
- Video downloading via yt-dlp running on the server
- Real-time status polling while download is in progress
- In-browser video playback (streaming from the server)
- Admin panel to manage users and all downloads
- Deployed on Railway (cloud PaaS)

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js 20 | JavaScript server-side execution |
| Web framework | Express.js 4 | HTTP routing and middleware |
| Auth provider | Clerk (clerk.com) | User management, JWT tokens |
| Database | PostgreSQL | Persistent storage of users and downloads |
| DB client | `pg` (node-postgres) | Query PostgreSQL from Node.js |
| Downloader | yt-dlp | Downloads videos from 1000+ sites |
| Media processor | ffmpeg | Converts downloaded video to MP4 |
| Frontend | Vanilla HTML/CSS/JS | No frontend framework — pure browser APIs |
| CSS framework | Tailwind CSS (CDN) | Utility-first styling on landing/auth pages |
| Animations | GSAP 3 | Dashboard entrance and transition animations |
| Deployment | Railway | PaaS cloud hosting |
| Containerization | Docker | Reproducible build environment on Railway |
| Version control | Git + GitHub | Source code hosting and Railway deployment trigger |

---

## 3. Project File Structure

```
VideoDownloader/
│
├── server.js                  ← Entry point: starts Express, registers routes
├── db.js                      ← PostgreSQL connection pool + schema init
├── package.json               ← Node.js project manifest + dependencies
├── Dockerfile                 ← Docker image: installs ffmpeg, yt-dlp, node deps
├── .dockerignore              ← Files excluded from Docker build
├── .env                       ← Local secrets (NOT committed to git)
├── .env.example               ← Template showing required variable names
├── .gitignore                 ← Files excluded from git
│
├── routes/
│   ├── auth.js                ← GET /api/auth/me
│   ├── downloads.js           ← CRUD for downloads + yt-dlp runner
│   └── admin.js               ← Admin-only user and download management
│
├── middleware/
│   └── auth.js                ← Clerk token verification + req.user injection
│
└── public/                    ← Static files served directly by Express
    ├── index.html             ← Landing page
    ├── login.html             ← Sign-in page
    ├── register.html          ← Sign-up page
    ├── dashboard.html         ← Main app (downloads, history, admin)
    ├── sso-callback.html      ← OAuth redirect handler
    ├── logo.png               ← Viddly logo
    └── favicon.ico            ← Browser tab icon
```

---

## 4. Architecture Overview

```
Browser (User)
     │
     │  HTTPS
     ▼
Railway Edge (CDN/Proxy)
     │
     │  HTTP internally
     ▼
Express Server (Node.js — server.js)
     │
     ├─── Static files (/public) ──────────────► HTML/CSS/JS to browser
     │
     ├─── /api/auth ──────────────────────────► routes/auth.js
     │         │
     │         └── Calls Clerk API to get user profile
     │
     ├─── /api/downloads ─────────────────────► routes/downloads.js
     │         │
     │         ├── Reads/writes PostgreSQL (downloads table)
     │         └── Spawns yt-dlp process → saves file to disk
     │
     └─── /api/admin ─────────────────────────► routes/admin.js
               │
               └── Reads/writes PostgreSQL (users + downloads tables)

Authentication flow:
Browser ──JWT token──► Clerk SDK (middleware/auth.js) ──userId──► PostgreSQL lookup
```

### Request lifecycle (example: start a download)

1. User pastes a URL and clicks "Download" in the browser
2. Browser sends `POST /api/downloads` with `Authorization: Bearer <JWT>`
3. Express passes request through `clerkMiddleware()` (verifies JWT signature)
4. `requireAuth()` checks the token is valid — returns 401 if not
5. `attachUser()` uses the Clerk `userId` to find/create the user row in PostgreSQL
6. Route handler creates a download record in the DB with status `pending`
7. `startDownload()` is called — spawns a `yt-dlp` child process
8. Server responds `202 Accepted` immediately (download runs in background)
9. Browser polls `GET /api/downloads` every 3 seconds
10. When yt-dlp finishes, the DB record is updated to `done` (or `failed`)
11. Browser sees the status change and shows the "Done" badge

---

## 5. Database Design

Viddly uses PostgreSQL with two tables.

### `users` table

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,        -- Clerk user ID (e.g. "user_abc123")
  role       TEXT NOT NULL DEFAULT 'user',    -- 'user' or 'admin'
  is_active  BOOLEAN NOT NULL DEFAULT true,   -- account can be disabled by admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key points:**
- The `id` is NOT an auto-increment number — it comes directly from Clerk. Clerk generates IDs like `user_3D86yrRAtc2bmpVi3whJDg3fcDx`.
- Profile data (name, email, photo) is **not stored in this table** — it lives in Clerk's cloud. The app calls the Clerk API to fetch it on demand.
- The first user to ever register automatically becomes `admin` (see `ensureUser()` in `middleware/auth.js`).

### `downloads` table

```sql
CREATE TABLE downloads (
  id           TEXT PRIMARY KEY,       -- UUID generated by the server (e.g. "550e8400-...")
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,          -- original URL the user pasted
  title        TEXT,                   -- video title (from yt-dlp output)
  filename     TEXT,                   -- actual file name on disk
  format       TEXT,                   -- file extension (mp4, webm, etc.)
  size_bytes   BIGINT,                 -- file size in bytes
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | downloading | converting | done | failed
  error        TEXT,                   -- error message if status = 'failed'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ             -- when status changed to done/failed
);

-- Indexes for fast lookups
CREATE INDEX idx_downloads_user   ON downloads(user_id);
CREATE INDEX idx_downloads_status ON downloads(status);
```

**Status lifecycle:**
```
pending → downloading → [converting] → done
                                    ↘ failed
```

**Foreign key:** `user_id REFERENCES users(id) ON DELETE CASCADE` means if a user is deleted, all their downloads are automatically deleted too.

---

## 6. Authentication — How Clerk Works

Clerk is a third-party authentication service. Viddly uses it instead of building auth from scratch.

### How the token flow works

```
1. User signs in at /login
   └─ Browser calls Clerk JS SDK
   └─ Clerk authenticates with email/password or Google OAuth
   └─ Clerk returns a JWT (JSON Web Token) — a signed string

2. Browser stores the session (Clerk manages this automatically)
   └─ When making API requests, the browser calls:
      window.Clerk.session.getToken() → returns fresh JWT string

3. Browser sends JWT in every API request:
   Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...

4. Server receives the request
   └─ clerkMiddleware() validates the JWT cryptographically
   └─ getAuth(req) extracts { userId, sessionId } from the verified token

5. attachUser() takes the userId and finds the user in PostgreSQL
   └─ If user doesn't exist yet → creates them (first sign-in)
   └─ Attaches user object to req.user for the route handler
```

### JWT (JSON Web Token) explained

A JWT has 3 parts separated by dots: `header.payload.signature`

- **Header:** algorithm used (RS256 = RSA + SHA-256)
- **Payload:** claims — `userId`, `sessionId`, `exp` (expiry), `iss` (issuer)
- **Signature:** cryptographic proof it wasn't tampered with

Clerk signs tokens with a **private key** that only Clerk knows. The server verifies them using Clerk's **public key** — this way the server never needs to call Clerk's API on every request (except for fetching profile data).

### OAuth (Google Sign-In) flow

```
1. User clicks "Continue with Google"
2. Browser calls: Clerk.client.signIn.authenticateWithRedirect({
     strategy: 'oauth_google',
     redirectUrl: window.location.origin + '/sso-callback'
   })
3. Browser redirects to Google's consent screen
4. User approves → Google redirects back to /sso-callback
5. sso-callback.html calls: window.Clerk.handleRedirectCallback()
6. Clerk exchanges the Google auth code for a Clerk session
7. User is now logged in → redirect to /dashboard
```

### Middleware chain

Every protected API route uses this middleware stack:

```javascript
const protect = [tokenFromQuery, requireAuth(), attachUser];
```

1. **`tokenFromQuery`** — moves `?token=` from URL query to the `Authorization` header. This is needed for the `<video>` streaming endpoint, since the browser doesn't send custom headers for `<video src="...">` tags.
2. **`requireAuth()`** — Clerk's built-in middleware. Returns HTTP 401 if the JWT is missing or invalid.
3. **`attachUser()`** — custom middleware that calls `getAuth(req)` to get the `userId`, then upserts the user in PostgreSQL and attaches the DB row to `req.user`.

---

## 7. API Reference — All Endpoints

### Auth Routes (`/api/auth`)

#### `GET /api/auth/me`
**Auth required:** Yes  
**Returns:** The current user's profile merged from Clerk + PostgreSQL.

```json
{
  "id": "user_3D86yrRAtc2bmpVi3whJDg3fcDx",
  "email": "sam@example.com",
  "username": "sam",
  "displayName": "Sam Smith",
  "imageUrl": "https://img.clerk.com/...",
  "role": "admin",
  "created_at": "2026-05-03T12:00:00Z"
}
```

---

### Download Routes (`/api/downloads`)

#### `POST /api/downloads`
**Auth required:** Yes  
**Body:** `{ "url": "https://vimeo.com/76979871" }`  
**Returns:** `202 Accepted` with the new download record ID.

```json
{ "id": "550e8400-e29b-41d4-a716-446655440000", "status": "pending", "message": "Download queued" }
```

The download starts immediately in the background. The response comes back before the video is downloaded.

#### `GET /api/downloads`
**Auth required:** Yes  
**Returns:** Array of all downloads for the current user, ordered newest first.

```json
[
  {
    "id": "550e8400...",
    "user_id": "user_abc...",
    "url": "https://vimeo.com/76979871",
    "title": "Sintel",
    "filename": "550e8400_Sintel.mp4",
    "format": "mp4",
    "size_bytes": 124500000,
    "status": "done",
    "error": null,
    "created_at": "2026-05-03T14:30:00Z",
    "completed_at": "2026-05-03T14:31:45Z"
  }
]
```

#### `GET /api/downloads/:id`
**Auth required:** Yes  
**Returns:** Single download record. Returns 403 if the download belongs to another user (unless admin).

#### `DELETE /api/downloads/:id`
**Auth required:** Yes  
**Effect:** Deletes the DB record AND removes the file from disk.

#### `GET /api/downloads/:id/file`
**Auth required:** Yes (supports `?token=` query param for video streaming)  
**Returns:** The actual video file binary with HTTP Range support (for `<video>` seeking).

---

### Admin Routes (`/api/admin`) — Admin only

All admin routes require `role = 'admin'` in the users table. Non-admins get `403 Forbidden`.

#### `GET /api/admin/users`
Returns all users enriched with their Clerk email and username.

#### `PUT /api/admin/users/:id/role`
**Body:** `{ "role": "admin" }` or `{ "role": "user" }`  
Changes a user's role. Cannot change your own role.

#### `PUT /api/admin/users/:id/active`
**Body:** `{ "is_active": false }`  
Enables or disables a user account. Cannot disable your own account.

#### `GET /api/admin/downloads`
Returns all downloads from all users (not filtered by current user).

#### `DELETE /api/admin/downloads/:id`
Deletes any download record regardless of which user owns it.

#### `GET /api/admin/stats`
Returns aggregate statistics.

```json
{
  "total_users": 5,
  "total_downloads": 42,
  "by_status": {
    "done": 38,
    "failed": 3,
    "pending": 1
  }
}
```

---

## 8. Backend Deep Dive

### `server.js` — The entry point

```javascript
app.use(cors({ origin: ... }));          // CORS policy
app.use(express.json());                  // Parse JSON request bodies
app.use(clerkMiddleware());               // Attach Clerk auth context to req
app.use(express.static('public'));        // Serve HTML/CSS/JS files
app.get('/clerk.browser.js', ...);       // Serve Clerk's browser SDK
app.use('/api/auth', require('./routes/auth'));
app.use('/api/downloads', require('./routes/downloads'));
app.use('/api/admin', require('./routes/admin'));
app.get('/dashboard', ...);              // Named routes (no .html extension)
app.get('/login', ...);
app.get('*', sendFile('index.html'));    // SPA fallback
```

### `db.js` — The database layer

Uses a **connection pool** (via `pg.Pool`), not a single persistent connection. A pool keeps several connections open and reuses them — this is more efficient than opening/closing a connection on every query.

```javascript
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: ... });

async function query(text, params) {
  const client = await pool.connect();   // get a connection from the pool
  try {
    return await client.query(text, params);
  } finally {
    client.release();                    // always return connection to pool
  }
}
```

**Parameterized queries** (`$1`, `$2`) are used throughout. This prevents **SQL injection** — a security vulnerability where a malicious user puts SQL code inside an input field.

### `routes/downloads.js` — The download engine

The `startDownload()` function is the heart of the app:

```javascript
function startDownload(id, url, _userId) {
  // 1. Write cookies to temp file (if YOUTUBE_COOKIES env var is set)
  const cookiesFile = '/tmp/yt-cookies.txt';
  if (process.env.YOUTUBE_COOKIES) {
    fs.writeFileSync(cookiesFile, process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n'));
  }

  // 2. Build yt-dlp argument array
  const args = [
    '--no-playlist',              // don't download entire playlists
    '--print-json',               // output video metadata as JSON to stdout
    '--newline',                  // flush JSON after each line
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',  // format preference
    '--merge-output-format', 'mp4',
    '--extractor-args', 'youtube:player_client=web_embedded',
    '--cookies', cookiesFile,     // authentication cookies (if available)
    '-o', outputTemplate,         // output filename template
    url
  ];

  // 3. Spawn yt-dlp as a child process
  const ytdlp = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // 4. Capture stdout (JSON metadata) to get title/filename/format
  ytdlp.stdout.on('data', (chunk) => { /* parse JSON lines */ });

  // 5. Capture stderr (error messages) for diagnostics
  ytdlp.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });

  // 6. When yt-dlp exits, update the DB record
  ytdlp.on('close', (code) => {
    if (code !== 0) {
      dbUpdate(id, ..., 'failed', errorOutput);
    } else {
      // If file isn't MP4, run ffmpeg to convert it
      if (!filename.endsWith('.mp4')) {
        convertToMp4(inputPath, outputPath).then(() => dbUpdate(..., 'done'));
      } else {
        dbUpdate(id, ..., 'done');
      }
    }
  });
}
```

**Child process** (`spawn`): Node.js can launch other programs (like yt-dlp) as separate operating system processes. `spawn` is non-blocking — the Node.js event loop keeps running while yt-dlp works in the background. Communication happens via `stdout` (output) and `stderr` (errors) pipes.

---

## 9. Frontend Pages

### `index.html` — Landing page
- Built with Tailwind CSS utility classes
- Fully responsive (uses `sm:`, `md:`, `lg:` breakpoint prefixes)
- Detects if user is already logged in (via Clerk) and swaps nav buttons to "Go to Dashboard"
- Animated with CSS keyframes (no GSAP here)

### `login.html` — Sign-in page
- Two-column layout: decorative left panel + form on the right
- Left panel hidden on mobile (`hidden lg:flex`)
- Custom dark-themed form using Clerk's JS API directly (`window.Clerk.client.signIn.create()`)
- Google OAuth button calls `authenticateWithRedirect()`
- On success: `window.Clerk.setActive()` then redirect to `/dashboard`

### `register.html` — Sign-up page
- Same layout as login
- **Two-step flow:**
  1. Collect email + password → call `signUp.create()` → call `prepareEmailAddressVerification()`
  2. Show verification code input → call `attemptEmailAddressVerification({ code })`
- On success: auto sign-in and redirect to `/dashboard`

### `sso-callback.html` — OAuth redirect handler
- This page catches the redirect after Google OAuth completes
- Calls `window.Clerk.handleRedirectCallback()` to exchange the OAuth code for a session
- Then immediately redirects to `/dashboard`

### `dashboard.html` — Main application
- Single-page app (no page reloads between sections)
- Three pages: Downloads, History, Admin Panel
- **Desktop:** collapsible sidebar on the left
- **Mobile:** sidebar becomes a slide-in overlay; bottom tab bar for navigation

**JavaScript architecture of the dashboard:**

```
init()
  └── /api/auth/me  → loads user profile, renders avatar
  └── loadStats()   → /api/downloads → counts totals
  └── loadRecent()  → /api/downloads → shows last 6 downloads
  └── startPolling() → every 3s, checks for active downloads

startDownload()
  └── POST /api/downloads → queues download on server
  └── startPolling() → begins watching for completion

openPlayer(id)
  └── GET /api/downloads/:id/file?token=... → streams video
  └── <video> element plays it in-browser
```

---

## 10. The Download Pipeline

Here is the exact journey of a video from URL to file:

```
User pastes URL → clicks Download
        │
        ▼
POST /api/downloads (HTTP 202 response immediately)
        │
        ▼
DB: INSERT download record (status = 'pending')
        │
        ▼
startDownload() spawns yt-dlp child process
        │
        ▼
DB: UPDATE status = 'downloading'
        │
        ▼
yt-dlp fetches video metadata from the site
yt-dlp downloads video stream + audio stream separately
yt-dlp merges them using ffmpeg internally
        │
        ▼
yt-dlp prints JSON metadata to stdout (title, format, size)
        │
        ├── If exit code = 0 (success):
        │       ├── If file is already .mp4:
        │       │       └── DB: UPDATE status = 'done'
        │       └── If file is .webm or other:
        │               └── ffmpeg converts to .mp4
        │               └── DB: UPDATE status = 'done'
        │
        └── If exit code ≠ 0 (failure):
                └── DB: UPDATE status = 'failed', error = last 500 chars of stderr
        │
        ▼
Browser polling detects status change
        │
        ▼
User can Play (stream) or Save (download to device)
```

### File storage
Files are saved in the `downloads/` directory on the server, with filenames like:
```
{uuid}_{video-title}.mp4
```
Example: `550e8400-e29b-41d4-a716_Sintel.mp4`

**Important limitation:** Railway's filesystem is **ephemeral**. Files are deleted every time the app redeploys. Production-grade apps would use cloud object storage (AWS S3, Cloudflare R2) instead.

---

## 11. Networking & CORS

### CORS (Cross-Origin Resource Sharing)

Browsers enforce a security rule: JavaScript from `https://site-a.com` cannot make API requests to `https://site-b.com` unless `site-b.com` explicitly allows it via CORS headers.

Viddly restricts which origins can call its API:

```javascript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(',');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);    // allow
    } else {
      callback(new Error('CORS: origin not allowed'));  // block
    }
  },
  credentials: true,  // allow cookies and Authorization headers
}));
```

In production, `ALLOWED_ORIGINS=https://videodownloader-production-1dd2.up.railway.app`.

`!origin` allows requests with no Origin header — this covers server-to-server calls (like Postman or curl).

### HTTP Status Codes used in Viddly

| Code | Meaning | When used |
|---|---|---|
| 200 OK | Success | GET requests that return data |
| 202 Accepted | Queued | POST /api/downloads (download started async) |
| 204 No Content | Success, no body | (not used currently) |
| 304 Not Modified | Cached response | Browser caching GET /api/downloads |
| 400 Bad Request | Invalid input | Missing URL, invalid role value |
| 401 Unauthorized | No/invalid token | Missing or expired JWT |
| 403 Forbidden | Valid token, no permission | Non-admin accessing admin routes |
| 404 Not Found | Resource missing | Download ID not found |
| 500 Internal Server Error | Server crash | Unhandled exceptions |

### Video streaming with HTTP Range requests

When the browser plays a video, it doesn't download the entire file upfront. It uses **HTTP Range requests** to request specific byte ranges:

```
Request:  GET /api/downloads/:id/file
          Range: bytes=0-1048576

Response: HTTP 206 Partial Content
          Content-Range: bytes 0-1048576/124500000
          Content-Length: 1048576
```

This allows seeking to any position in the video without downloading the whole file first. The server handles this in `routes/downloads.js`:

```javascript
if (range) {
  const [start, end] = range.replace(/bytes=/, '').split('-');
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': end - start + 1,
    'Content-Type': 'video/mp4'
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}
```

---

## 12. Deployment on Railway

### Why Railway (not Vercel)?

Vercel is optimized for **serverless functions** — short-lived, stateless request handlers. Viddly needs:
- A **persistent process** (to run yt-dlp in the background)
- **Filesystem access** (to save downloaded files)
- **System tools** (ffmpeg, yt-dlp binaries)

Railway gives a traditional always-on server environment.

### How Railway builds the app

Railway detects the `Dockerfile` in the project root and uses it to build a Docker image:

```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip curl

# Install yt-dlp (latest version from GitHub)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev   # install only production dependencies
COPY . .
RUN mkdir -p downloads

EXPOSE 3000
CMD ["node", "server.js"]
```

**Docker layers** are cached — if `package.json` doesn't change, Railway reuses the `npm install` layer and only rebuilds what changed. This makes deploys faster.

### Deploy trigger

Every `git push` to the `main` branch on GitHub automatically triggers a Railway redeploy. Railway:
1. Clones the repo
2. Builds the Docker image
3. Starts the new container
4. Routes traffic to it (zero-downtime swap)

---

## 13. Environment Variables

Environment variables are secrets/config values that live outside the codebase.

| Variable | Required | Description |
|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | Yes | Public Clerk key (safe to expose in HTML) |
| `CLERK_SECRET_KEY` | Yes | Private Clerk key (server-side only, never expose) |
| `DATABASE_URL` | Yes | Full PostgreSQL connection string |
| `PORT` | No | Server port (defaults to 3000; Railway sets this automatically) |
| `ALLOWED_ORIGINS` | No | Comma-separated list of allowed CORS origins |
| `YOUTUBE_COOKIES` | No | Netscape-format YouTube cookies (to bypass bot detection) |

**Why two Clerk keys?**  
- `CLERK_PUBLISHABLE_KEY` (`pk_test_...`) — used in the browser to initialize Clerk JS. It's safe to include in HTML because it only identifies your Clerk application, it doesn't grant admin access.  
- `CLERK_SECRET_KEY` (`sk_test_...`) — used on the server to call Clerk's management API (e.g., fetching user profiles). Must never be sent to the browser.

---

## 14. Security Model

### What is protected

- All API endpoints require a valid Clerk JWT (except static file serving)
- Admin routes additionally require `role = 'admin'` in the PostgreSQL users table
- Users can only see/delete their own downloads (enforced in every route handler)
- CORS limits which web origins can call the API

### What is not protected

- The `downloads/` folder is not behind auth for direct filesystem access — but files are only accessible through the `/api/downloads/:id/file` endpoint which does auth-check. The filenames include UUID prefixes, making them hard to guess.
- Railway's filesystem is accessible to anyone with Railway admin access to your project.

### SQL Injection prevention

All database queries use **parameterized statements**:

```javascript
// SAFE — parameter is never interpolated into SQL string
query('SELECT * FROM users WHERE id = $1', [userId]);

// DANGEROUS — never do this (we don't, but this is what SQL injection looks like)
query(`SELECT * FROM users WHERE id = '${userId}'`);
```

### XSS (Cross-Site Scripting) prevention

The dashboard always escapes user-supplied content before inserting into HTML:

```javascript
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Used for every user-supplied value rendered in the table
container.innerHTML = `<td>${escHtml(download.title)}</td>`;
```

---

## 15. Known Limitations & Future Work

| Limitation | Impact | Potential fix |
|---|---|---|
| Ephemeral filesystem | Files deleted on redeploy | Use Cloudflare R2 or AWS S3 for storage |
| YouTube bot detection | YouTube downloads often fail | Residential proxy or PO token provider |
| No download queue limit | A user could start 100 simultaneous downloads | Rate limiting per user |
| No file size limit | A 50GB video would fill the disk | Check `size_bytes` before downloading |
| No download progress % | Can't show how far along a download is | Parse yt-dlp's `--progress` output |
| Cookies expire | YouTube cookies must be manually refreshed | Automate cookie refresh |
| Single server instance | Doesn't scale horizontally | Use Redis for shared state across instances |

---

## 16. Supported Sites for yt-dlp

yt-dlp supports 1,000+ video hosting sites. Here are well-known categories for your professor:

### Video Platforms
| Site | URL | Notes |
|---|---|---|
| Vimeo | vimeo.com | Fully supported, no auth issues |
| Dailymotion | dailymotion.com | Works well |
| Twitch (VODs & clips) | twitch.tv | Clips and past broadcasts |
| Rumble | rumble.com | Works reliably |
| Odysee / LBRY | odysee.com | Decentralized video |
| Bilibili | bilibili.com | Chinese video platform |
| Niconico | nicovideo.jp | Japanese video platform |

### Social Media Video
| Site | URL | Notes |
|---|---|---|
| Twitter / X | twitter.com / x.com | Public tweet videos |
| Reddit | reddit.com | Videos posted to Reddit |
| TikTok | tiktok.com | Public videos |
| Instagram | instagram.com | Public posts/reels |
| Facebook | facebook.com | Public videos |
| LinkedIn | linkedin.com | Public video posts |

### Educational & News
| Site | URL | Notes |
|---|---|---|
| TED Talks | ted.com | All public talks |
| Khan Academy | khanacademy.org | All lessons |
| Coursera | coursera.org | Some content |
| BBC News | bbc.co.uk | News video clips |
| CNN | cnn.com | News clips |

### Music & Audio
| Site | URL | Notes |
|---|---|---|
| SoundCloud | soundcloud.com | Public tracks |
| Bandcamp | bandcamp.com | Public releases |
| Mixcloud | mixcloud.com | DJ mixes |

### Test URLs to demonstrate to your professor
```
https://vimeo.com/76979871               ← Sintel short film (always works)
https://www.dailymotion.com/video/x7tgd9i  ← Dailymotion test
https://www.ted.com/talks/brene_brown_the_power_of_vulnerability  ← TED talk
```

---

## 17. Glossary

| Term | Definition |
|---|---|
| **API** | Application Programming Interface — a set of URL endpoints a server exposes for other programs to call |
| **REST** | Representational State Transfer — a style of API design using HTTP verbs (GET, POST, PUT, DELETE) |
| **JWT** | JSON Web Token — a cryptographically signed string carrying user identity claims |
| **OAuth** | Open Authorization — a standard for delegating login to a third party (e.g. "Login with Google") |
| **Middleware** | A function that runs between receiving an HTTP request and sending a response |
| **Child process** | A separate operating system process spawned by the Node.js app (e.g. yt-dlp) |
| **CORS** | Cross-Origin Resource Sharing — browser security policy controlling which domains can call an API |
| **Connection pool** | A cache of database connections reused across requests instead of opening a new one each time |
| **Ephemeral filesystem** | A disk that resets when the server restarts (like Railway's default) |
| **Parameterized query** | A SQL query where user input is passed as a separate parameter, preventing SQL injection |
| **HTTP Range request** | A request for a specific byte range of a file, used for video seeking |
| **PaaS** | Platform as a Service — a cloud hosting service that manages the server infrastructure for you (e.g. Railway) |
| **Docker** | A tool that packages an application and all its dependencies into a portable container image |
| **Environment variable** | A key-value configuration pair set outside the code, used for secrets and per-environment settings |
| **yt-dlp** | A command-line tool that extracts and downloads video/audio from 1000+ websites |
| **ffmpeg** | A command-line multimedia processing tool used to convert between video formats |
| **UUID** | Universally Unique Identifier — a randomly generated 128-bit ID (e.g. `550e8400-e29b-41d4-a716`) |
| **Upsert** | A database operation that inserts a record if it doesn't exist, or updates it if it does (`INSERT ... ON CONFLICT DO ...`) |
| **XSS** | Cross-Site Scripting — a vulnerability where attacker JavaScript gets injected into a page |
| **SQL Injection** | A vulnerability where malicious SQL code is injected through user input fields |

---

*Generated for study purposes — Viddly v2.0, May 2026*
