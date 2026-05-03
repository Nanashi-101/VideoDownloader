const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { protect } = require('../middleware/auth');

const router        = express.Router();
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const activeDownloads = new Map();

// ── DB helpers ────────────────────────────────────────────────────────────────
const dbCreate  = (id, userId, url) =>
  query('INSERT INTO downloads (id, user_id, url, status) VALUES ($1,$2,$3,$4)',
        [id, userId, url, 'pending']);

const dbUpdate  = (id, title, filename, format, sizeBytes, status, error, completedAt) =>
  query(`UPDATE downloads SET title=$1,filename=$2,format=$3,size_bytes=$4,
         status=$5,error=$6,completed_at=$7 WHERE id=$8`,
        [title, filename, format, sizeBytes, status, error, completedAt, id]);

const dbStatus  = (id, status, error) =>
  query(`UPDATE downloads SET status=$1,error=$2,completed_at=NOW() WHERE id=$3`,
        [status, error, id]);

const dbGet     = async (id) => (await query('SELECT * FROM downloads WHERE id=$1',[id])).rows[0];

const dbList    = async (userId) =>
  (await query('SELECT * FROM downloads WHERE user_id=$1 ORDER BY created_at DESC',[userId])).rows;

const dbDelete  = (id, userId) =>
  query('DELETE FROM downloads WHERE id=$1 AND user_id=$2',[id, userId]);

const dbAdminDel = (id) =>
  query('DELETE FROM downloads WHERE id=$1',[id]);

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/downloads
router.post('/', protect, async (req, res) => {
  const { url } = req.body;
  if (!url || !url.trim()) return res.status(400).json({ error: 'URL is required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const id = uuidv4();
  await dbCreate(id, req.user.id, url.trim());
  startDownload(id, url.trim(), req.user.id);
  res.status(202).json({ id, status: 'pending', message: 'Download queued' });
});

// GET /api/downloads
router.get('/', protect, async (req, res) => {
  res.json(await dbList(req.user.id));
});

// GET /api/downloads/:id
router.get('/:id', protect, async (req, res) => {
  const row = await dbGet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  res.json(row);
});

// DELETE /api/downloads/:id
router.delete('/:id', protect, async (req, res) => {
  const row = await dbGet(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  const proc = activeDownloads.get(req.params.id);
  if (proc) { proc.kill(); activeDownloads.delete(req.params.id); }

  if (row.filename) {
    const filePath = path.join(DOWNLOADS_DIR, row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  if (req.user.role === 'admin') await dbAdminDel(req.params.id);
  else await dbDelete(req.params.id, req.user.id);

  res.json({ message: 'Deleted' });
});

// GET /api/downloads/:id/file  — range-aware streaming, ?token= supported
router.get('/:id/file', protect, async (req, res) => {
  const row = await dbGet(req.params.id);
  if (!row || row.status !== 'done') return res.status(404).json({ error: 'File not ready' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  const filePath = path.join(DOWNLOADS_DIR, row.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

  const stat        = fs.statSync(filePath);
  const fileSize    = stat.size;
  const range       = req.headers.range;
  const ext         = path.extname(row.filename).toLowerCase();
  const mimeMap     = { '.mp4':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska',
                        '.avi':'video/x-msvideo','.mov':'video/quicktime','.m4v':'video/mp4','.mp3':'audio/mpeg' };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  if (range) {
    const parts     = range.replace(/bytes=/, '').split('-');
    const start     = parseInt(parts[0], 10);
    const end       = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, { 'Content-Range':`bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':'bytes','Content-Length':chunkSize,'Content-Type':contentType });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length':fileSize,'Content-Type':contentType,
      'Accept-Ranges':'bytes','Content-Disposition':`attachment; filename="${row.filename}"` });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── yt-dlp runner ─────────────────────────────────────────────────────────────
function startDownload(id, url, _userId) {
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}_%(title).80s.%(ext)s`);
  dbUpdate(id, null, null, null, null, 'downloading', null, null).catch(console.error);

  // Write YouTube cookies to temp file if provided via env var
  // Railway may store newlines as literal \n — normalize them
  const cookiesFile = '/tmp/yt-cookies.txt';
  const hasCookies  = !!process.env.YOUTUBE_COOKIES;
  if (hasCookies) {
    const cookieContent = process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n');
    require('fs').writeFileSync(cookiesFile, cookieContent, 'utf8');
    console.log(`[yt-dlp] Cookies file written. First line: ${cookieContent.split('\n')[0]}`);
    console.log(`[yt-dlp] Cookie file size: ${cookieContent.length} chars`);
  } else {
    console.log('[yt-dlp] No YOUTUBE_COOKIES env var set — proceeding without cookies');
  }

  const args = [
    '--no-playlist','--print-json','--newline',
    '-f','bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
    '--merge-output-format','mp4',
    // Use web clients that don't require PO tokens
    '--extractor-args','youtube:player_client=web,mweb,web_embedded',
    ...(hasCookies ? ['--cookies', cookiesFile] : []),
    '-o', outputTemplate, url
  ];

  console.log(`[yt-dlp] Starting download: ${url}`);
  console.log(`[yt-dlp] Using cookies: ${hasCookies}`);

  const YTDLP = [
    'yt-dlp', process.env.YT_DLP_PATH,
    `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\yt-dlp.exe`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe`,
    'C:\\Windows\\System32\\yt-dlp.exe',
    `${process.env.USERPROFILE}\\scoop\\shims\\yt-dlp.exe`,
  ].filter(Boolean);

  let ytdlp;
  for (const cmd of YTDLP) {
    try { ytdlp = spawn(cmd, args, { stdio: ['ignore','pipe','pipe'] }); break; }
    catch { /* try next */ }
  }
  if (!ytdlp) ytdlp = spawn('python', ['-m','yt_dlp',...args], { stdio:['ignore','pipe','pipe'] });

  activeDownloads.set(id, ytdlp);
  let jsonBuffer = '', title = null, filename = null, format = null, sizeBytes = null;

  ytdlp.stdout.on('data', (chunk) => {
    jsonBuffer += chunk.toString();
    const lines = jsonBuffer.split('\n');
    jsonBuffer  = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const info    = JSON.parse(line);
        title         = info.title || null;
        format        = info.ext   || null;
        sizeBytes     = info.filesize || info.filesize_approx || null;
        const safe    = (info.title||'video').replace(/[/\\?%*:|"<>]/g,'_').substring(0,80);
        filename      = `${id}_${safe}.${info.ext||'mp4'}`;
      } catch { /* partial */ }
    }
  });

  let errorOutput = '';
  ytdlp.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    errorOutput += text;
    console.error(`[yt-dlp stderr] ${text.trim()}`);
  });

  ytdlp.on('close', (code) => {
    activeDownloads.delete(id);
    if (code !== 0) {
      const errMsg = errorOutput.slice(-500) || `yt-dlp exited with code ${code}`;
      dbUpdate(id, title, filename, format, sizeBytes, 'failed', errMsg, new Date().toISOString()).catch(console.error);
      return;
    }
    const needsConversion = filename && !filename.toLowerCase().endsWith('.mp4');
    if (needsConversion) {
      const inputPath  = path.join(DOWNLOADS_DIR, filename);
      const mp4Name    = filename.replace(/\.[^.]+$/, '.mp4');
      const outputPath = path.join(DOWNLOADS_DIR, mp4Name);
      dbUpdate(id, title, filename, format, sizeBytes, 'converting', null, null).catch(console.error);
      console.log(`[ffmpeg] Converting ${filename} → ${mp4Name}`);
      convertToMp4(inputPath, outputPath)
        .then(() => {
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
          dbUpdate(id, title, mp4Name, 'mp4', sizeBytes, 'done', null, new Date().toISOString()).catch(console.error);
          console.log(`[✓] Conversion done: ${mp4Name}`);
        })
        .catch((err) => {
          console.error(`[✗] ffmpeg failed: ${err.message}`);
          dbUpdate(id, title, filename, format, sizeBytes, 'done', null, new Date().toISOString()).catch(console.error);
        });
    } else {
      dbUpdate(id, title, filename, 'mp4', sizeBytes, 'done', null, new Date().toISOString()).catch(console.error);
    }
  });

  ytdlp.on('error', (err) => {
    activeDownloads.delete(id);
    const errMsg = err.code === 'ENOENT'
      ? 'yt-dlp not found — install it from https://github.com/yt-dlp/yt-dlp'
      : err.message;
    dbUpdate(id, null, null, null, null, 'failed', errMsg, new Date().toISOString()).catch(console.error);
  });
}

// ── ffmpeg MP4 converter ──────────────────────────────────────────────────────
function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const FFMPEG = [
      'ffmpeg', process.env.FFMPEG_PATH,
      `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\ffmpeg.exe`,
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      `${process.env.USERPROFILE}\\scoop\\shims\\ffmpeg.exe`,
    ].filter(Boolean);

    let ffmpegCmd = 'ffmpeg';
    for (const cmd of FFMPEG) {
      try { require('child_process').execFileSync(cmd,['-version'],{stdio:'ignore'}); ffmpegCmd=cmd; break; }
      catch {}
    }

    const run = (extraArgs) => new Promise((res, rej) => {
      const proc = spawn(ffmpegCmd, ['-i', inputPath, ...extraArgs, '-movflags', '+faststart', '-y', outputPath],
        { stdio: ['ignore','ignore','pipe'] });
      let errOut = '';
      proc.stderr.on('data', d => { errOut += d.toString(); });
      proc.on('close', code => (code === 0 ? res() : rej(new Error(errOut.slice(-300)))));
      proc.on('error', rej);
    });

    run(['-c','copy'])
      .then(resolve)
      .catch(() => run(['-c:v','libx264','-preset','fast','-crf','22','-c:a','aac','-b:a','128k'])
        .then(resolve).catch(reject));
  });
}

module.exports = router;
