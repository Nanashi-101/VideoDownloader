const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { protect } = require('../middleware/auth');
const { R2_ENABLED, uploadFile, getPresignedUrl, deleteFile } = require('../lib/r2');

const router        = express.Router();
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const activeDownloads = new Map();

// ── DB helpers ────────────────────────────────────────────────────────────────
const dbCreate  = (id, userId, url) =>
  query('INSERT INTO downloads (id, user_id, url, status) VALUES ($1,$2,$3,$4)',
        [id, userId, url, 'pending']);

const dbUpdate  = (id, title, filename, format, sizeBytes, status, error, completedAt, r2Key = null) =>
  query(`UPDATE downloads SET title=$1,filename=$2,format=$3,size_bytes=$4,
         status=$5,error=$6,completed_at=$7,r2_key=$8 WHERE id=$9`,
        [title, filename, format, sizeBytes, status, error, completedAt, r2Key, id]);

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

  // Delete from R2 if stored there
  if (row.r2_key) await deleteFile(row.r2_key);

  // Delete from local disk if it exists
  if (row.filename) {
    const filePath = path.join(DOWNLOADS_DIR, row.filename);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }
  }

  if (req.user.role === 'admin') await dbAdminDel(req.params.id);
  else await dbDelete(req.params.id, req.user.id);

  res.json({ message: 'Deleted' });
});

// GET /api/downloads/:id/file — R2 presigned URL redirect OR local stream
router.get('/:id/file', protect, async (req, res) => {
  const row = await dbGet(req.params.id);
  if (!row || row.status !== 'done') return res.status(404).json({ error: 'File not ready' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  // ── R2 path: generate presigned URL and redirect ──────────────────────────
  if (row.r2_key && R2_ENABLED) {
    try {
      const signedUrl = await getPresignedUrl(row.r2_key, 3600);
      return res.redirect(302, signedUrl);
    } catch (err) {
      console.error('[R2] Failed to generate presigned URL:', err.message);
      return res.status(500).json({ error: 'Could not generate file URL' });
    }
  }

  // ── Local disk fallback ───────────────────────────────────────────────────
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
  const cookiesFile = '/tmp/yt-cookies.txt';
  const hasCookies  = !!process.env.YOUTUBE_COOKIES;
  if (hasCookies) {
    const cookieContent = process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n');
    fs.writeFileSync(cookiesFile, cookieContent, 'utf8');
    console.log(`[yt-dlp] Cookies written. First line: ${cookieContent.split('\n')[0]}`);
  } else {
    console.log('[yt-dlp] No YOUTUBE_COOKIES set — proceeding without cookies');
  }

  const args = [
    '--no-playlist','--print-json','--newline',
    '-f','bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[height<=1080]/best',
    '--merge-output-format','mp4',
    '--extractor-args','youtube:player_client=web_embedded',
    ...(hasCookies ? ['--cookies', cookiesFile] : []),
    '-o', outputTemplate, url
  ];

  console.log(`[yt-dlp] Starting: ${url} | R2: ${R2_ENABLED}`);

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
        const info = JSON.parse(line);
        title      = info.title || null;
        format     = info.ext   || null;
        sizeBytes  = info.filesize || info.filesize_approx || null;
        const safe = (info.title||'video').replace(/[/\\?%*:|"<>]/g,'_').substring(0,80);
        filename   = `${id}_${safe}.${info.ext||'mp4'}`;
      } catch { /* partial line */ }
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

    // Determine final local file path
    const needsConversion = filename && !filename.toLowerCase().endsWith('.mp4');
    const localFile = needsConversion
      ? path.join(DOWNLOADS_DIR, filename.replace(/\.[^.]+$/, '.mp4'))
      : path.join(DOWNLOADS_DIR, filename);
    const finalFilename = path.basename(localFile);

    if (needsConversion) {
      const inputPath = path.join(DOWNLOADS_DIR, filename);
      dbUpdate(id, title, finalFilename, format, sizeBytes, 'converting', null, null).catch(console.error);
      console.log(`[ffmpeg] Converting ${filename} → ${finalFilename}`);
      convertToMp4(inputPath, localFile)
        .then(() => {
          try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
          finalizeDownload(id, title, finalFilename, localFile, sizeBytes);
        })
        .catch((err) => {
          console.error(`[ffmpeg] Failed: ${err.message}`);
          // Still mark as done with original file
          finalizeDownload(id, title, filename, path.join(DOWNLOADS_DIR, filename), sizeBytes);
        });
    } else {
      finalizeDownload(id, title, finalFilename, localFile, sizeBytes);
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

// ── Post-download: upload to R2 or keep on disk ───────────────────────────────
async function finalizeDownload(id, title, filename, localPath, sizeBytes) {
  const now = new Date().toISOString();

  if (R2_ENABLED) {
    try {
      dbUpdate(id, title, filename, 'mp4', sizeBytes, 'uploading', null, null).catch(console.error);
      const r2Key = await uploadFile(localPath, filename, 'video/mp4');
      // Delete local file after successful R2 upload to save disk space
      try { if (fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch {}
      await dbUpdate(id, title, filename, 'mp4', sizeBytes, 'done', null, now, r2Key);
      console.log(`[✓] Done (R2): ${filename}`);
    } catch (err) {
      console.error(`[R2] Upload failed, keeping local file: ${err.message}`);
      // Fall back to local storage if R2 upload fails
      await dbUpdate(id, title, filename, 'mp4', sizeBytes, 'done', null, now, null);
    }
  } else {
    await dbUpdate(id, title, filename, 'mp4', sizeBytes, 'done', null, now, null);
    console.log(`[✓] Done (local): ${filename}`);
  }
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
