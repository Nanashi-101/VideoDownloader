// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let pollTimer   = null;
let activeVideoId = null;
let sidebarCollapsed = false;

const getToken = async () => {
  if (window.__clerk?.session) return await window.__clerk.session.getToken();
  return '';
};
const logout = async () => {
  await window.__clerk?.signOut();
  window.location.href = '/login';
};
const confirmLeave = async () => {
  return await showConfirm({ title: 'Leave dashboard?', message: 'You will be taken to the Viddly landing page.', okLabel: 'Go to home', okStyle: 'primary' });
};

async function api(path, opts = {}) {
  const token = await getToken();
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (res.status === 401) logout();
  return res;
}

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════
async function init() {
  const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!r.ok) { await logout(); return; }
  currentUser = await r.json();

  const name     = currentUser.displayName || currentUser.username || 'User';
  const initials = name[0].toUpperCase();

  function renderAvatar(el, size) {
    if (currentUser.imageUrl) {
      el.innerHTML = `<img src="${currentUser.imageUrl}" alt="${name}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:99px;display:block"/>`;
      el.style.background = 'none';
    } else {
      el.textContent = initials;
    }
  }
  renderAvatar(document.getElementById('userAvatar'),   32);
  renderAvatar(document.getElementById('topbarAvatar'), 26);

  // Mobile nav avatar
  const mnavAv = document.getElementById('mnavAvatar');
  if (currentUser.imageUrl) {
    mnavAv.innerHTML = `<img src="${currentUser.imageUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"/>`;
    mnavAv.style.background = 'none';
  } else {
    mnavAv.textContent = initials;
  }

  // User bottom sheet
  const sheetAv = document.getElementById('sheetAvatar');
  if (currentUser.imageUrl) {
    sheetAv.innerHTML = `<img src="${currentUser.imageUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"/>`;
    sheetAv.style.background = 'none';
  } else {
    sheetAv.textContent = initials;
  }
  document.getElementById('sheetName').textContent  = name;
  document.getElementById('sheetEmail').textContent = currentUser.email || '';
  const roleBadge = document.getElementById('sheetRoleBadge');
  if (currentUser.role === 'admin') {
    roleBadge.textContent = '👑 Admin';
    roleBadge.style.background = 'rgba(124,58,237,0.2)';
    roleBadge.style.color = '#a78bfa';
  } else {
    roleBadge.textContent = '👤 User';
    roleBadge.style.background = 'rgba(59,130,246,0.12)';
    roleBadge.style.color = '#60a5fa';
  }

  document.getElementById('userName').textContent   = name;
  document.getElementById('topbarName').textContent = name;
  document.getElementById('userRole').textContent   = currentUser.role === 'admin' ? '👑 Admin' : '👤 User';

  if (currentUser.role === 'admin') {
    document.getElementById('navAdmin').style.display    = 'flex';
    document.getElementById('mnavAdmin').style.display   = 'flex';
    document.getElementById('sheetAdminBtn').style.display = 'flex';
  }

  loadStats();
  loadRecent();
  startPolling();
  runEntranceAnim();
}

// ═══════════════════════════════════════════════════════════════
// Entrance animation
// ═══════════════════════════════════════════════════════════════
function runEntranceAnim() {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) {
    gsap.from('.sidebar', { x: -20, opacity: 0, duration: 0.5, ease: 'power3.out' });
  }
  gsap.from('.topbar',  { y: -10, opacity: 0, duration: 0.4, ease: 'power2.out', delay: isMobile ? 0 : 0.1 });
  gsap.from('#statsGrid > *', { y: 24, opacity: 0, duration: 0.5, stagger: 0.07, ease: 'power3.out', delay: isMobile ? 0.1 : 0.2 });
  gsap.from('#dlCard',  { y: 16, opacity: 0, duration: 0.45, ease: 'power2.out', delay: isMobile ? 0.2 : 0.45 });
  gsap.from('#recentContainer', { y: 14, opacity: 0, duration: 0.4, ease: 'power2.out', delay: isMobile ? 0.3 : 0.55 });
}

// ═══════════════════════════════════════════════════════════════
// Sidebar (desktop only — hidden on mobile)
// ═══════════════════════════════════════════════════════════════
function toggleSidebar() {
  if (window.innerWidth > 768) {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  }
}

function closeMobileSidebar() {
  // No-op — sidebar is fully hidden on mobile; kept for any inline onclick references
}

// ═══════════════════════════════════════════════════════════════
// User bottom sheet (mobile)
// ═══════════════════════════════════════════════════════════════
function openUserSheet() {
  document.getElementById('userSheetBackdrop').classList.add('show');
  document.getElementById('userSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeUserSheet() {
  document.getElementById('userSheetBackdrop').classList.remove('show');
  document.getElementById('userSheet').classList.remove('open');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════
// Page navigation
// ═══════════════════════════════════════════════════════════════
const pageMap = {
  downloads: { page: 'pageDownloads', nav: 'navDownloads', label: 'Downloads' },
  history:   { page: 'pageHistory',   nav: 'navHistory',   label: 'History'   },
  admin:     { page: 'pageAdmin',     nav: 'navAdmin',      label: 'Admin'     },
};

function showPage(name) {
  Object.values(pageMap).forEach(({ page, nav }) => {
    document.getElementById(page).style.display = 'none';
    document.getElementById(nav)?.classList.remove('active');
  });
  const { page, nav, label } = pageMap[name];
  const el = document.getElementById(page);
  el.style.display = 'block';
  document.getElementById(nav)?.classList.add('active');
  document.getElementById('breadcrumbCurrent').textContent = label;

  // Sync mobile bottom nav
  ['mnavDownloads','mnavHistory','mnavAdmin'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  const mnavMap = { downloads: 'mnavDownloads', history: 'mnavHistory', admin: 'mnavAdmin' };
  document.getElementById(mnavMap[name])?.classList.add('active');

  gsap.from(el, { y: 12, opacity: 0, duration: 0.3, ease: 'power2.out' });

  if (name === 'history') loadHistory();
  if (name === 'admin')   loadAdmin();
}

// ═══════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════
async function loadStats() {
  const res = await api('/api/downloads');
  if (!res || !res.ok) return;
  const data = await res.json();

  animateCount('st-total',  data.length);
  animateCount('st-done',   data.filter(d => d.status === 'done').length);
  animateCount('st-active', data.filter(d => ['downloading','pending','uploading'].includes(d.status)).length);
  animateCount('st-failed', data.filter(d => d.status === 'failed').length);

  const active = data.filter(d => ['downloading','pending','uploading'].includes(d.status)).length;
  const badge = document.getElementById('pendingBadge');
  if (active > 0) { badge.textContent = active; badge.style.display = 'inline'; }
  else { badge.style.display = 'none'; }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  gsap.to({ val: current }, { val: target, duration: 0.8, ease: 'power2.out',
    onUpdate: function() { el.textContent = Math.round(this.targets()[0].val); }
  });
}

// ═══════════════════════════════════════════════════════════════
// Download
// ═══════════════════════════════════════════════════════════════
async function startDownload() {
  const url  = document.getElementById('urlInput').value.trim();
  const btn  = document.getElementById('dlBtn');
  const feed = document.getElementById('dlFeedback');
  if (!url) { gsap.from('#urlInput', { x: -6, duration: 0.3, ease: 'elastic.out(1,0.5)' }); return; }

  btn.disabled = true;
  btn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;margin-right:6px;vertical-align:middle"></span>Queuing…`;
  feed.innerHTML = '<span style="color:#60a5fa">⏳ Adding to queue…</span>';

  const res = await api('/api/downloads', { method: 'POST', body: JSON.stringify({ url }) });
  btn.disabled = false;
  btn.innerHTML = `<svg style="display:inline;width:14px;height:14px;margin-right:6px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19,12 12,19 5,12"/></svg>Download`;

  if (!res) return;
  const data = await res.json();

  if (!res.ok) {
    feed.innerHTML = `<span style="color:#f87171">✗ ${escHtml(data.error)}</span>`;
    showToast(data.error, 'error');
    return;
  }

  feed.innerHTML = `<span style="color:#34d399">✓ Download queued — it will appear below shortly</span>`;
  document.getElementById('urlInput').value = '';
  showToast('Download queued!', 'success');
  loadRecent();
  loadStats();
  startPolling();
  gsap.from('#recentContainer tr:first-child', { y: -10, opacity: 0, duration: 0.3, ease: 'power2.out', delay: 0.4 });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') startDownload();
  });
});

// ═══════════════════════════════════════════════════════════════
// Load lists
// ═══════════════════════════════════════════════════════════════
async function loadRecent() {
  const res = await api('/api/downloads');
  if (!res) return;
  const data = await res.json();
  renderTable(data.slice(0, 6), 'recentContainer');
  updateStats(data);
}

async function loadHistory() {
  document.getElementById('historyContainer').innerHTML = renderSkeletons(5);
  const res = await api('/api/downloads');
  if (!res) return;
  const data = await res.json();
  renderTable(data, 'historyContainer');
}

function updateStats(data) {
  animateCount('st-total',  data.length);
  animateCount('st-done',   data.filter(d => d.status === 'done').length);
  animateCount('st-active', data.filter(d => ['downloading','pending','uploading'].includes(d.status)).length);
  animateCount('st-failed', data.filter(d => d.status === 'failed').length);
  const active = data.filter(d => ['downloading','pending','uploading'].includes(d.status)).length;
  const badge = document.getElementById('pendingBadge');
  if (active > 0) { badge.textContent = active; badge.style.display = 'inline'; }
  else badge.style.display = 'none';
}

function renderSkeletons(n) {
  return `<table class="tbl"><tbody>` + Array(n).fill(0).map(() => `
    <tr style="border-top:1px solid var(--border-muted)">
      <td style="padding:14px 12px"><div class="skel" style="height:14px;width:60%;margin-bottom:6px"></div><div class="skel" style="height:10px;width:40%"></div></td>
      <td style="padding:14px 12px"><div class="skel" style="height:20px;width:70px;border-radius:99px"></div></td>
      <td style="padding:14px 12px"><div class="skel" style="height:12px;width:40px"></div></td>
      <td style="padding:14px 12px"><div class="skel" style="height:12px;width:70px"></div></td>
      <td></td>
    </tr>`).join('') + `</tbody></table>`;
}

function renderTable(items, containerId) {
  const container = document.getElementById(containerId);
  if (!items.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">No downloads yet</div><div class="empty-sub">Paste a URL above to get started</div></div>`;
    return;
  }
  container.innerHTML = `
    <div style="overflow-x:auto">
    <table class="tbl">
      <thead><tr>
        <th style="min-width:240px">Title / URL</th>
        <th>Status</th>
        <th>Format</th>
        <th>Date</th>
        <th style="text-align:right">Actions</th>
      </tr></thead>
      <tbody>${items.map(renderRow).join('')}</tbody>
    </table></div>`;
}

function renderRow(d) {
  const statusHtml = {
    done:        `<span class="badge badge-done"><span class="dot dot-done"></span>Done</span>`,
    downloading: `<span class="badge badge-dl"><span class="dot dot-dl"></span>Downloading<div class="progress-wrap" style="width:60px;margin-left:4px"><div class="progress-bar"></div></div></span>`,
    converting:  `<span class="badge" style="background:rgba(168,85,247,0.12);color:#c084fc;border:1px solid rgba(168,85,247,0.25)"><span class="dot" style="background:#c084fc;animation:pulse 1s infinite"></span>Converting<div class="progress-wrap" style="width:50px;margin-left:4px"><div class="progress-bar" style="background:linear-gradient(90deg,#9333ea,#7c3aed)"></div></div></span>`,
    uploading:   `<span class="badge" style="background:rgba(20,184,166,0.12);color:#2dd4bf;border:1px solid rgba(20,184,166,0.25)"><span class="dot" style="background:#2dd4bf;animation:pulse 1s infinite"></span>Uploading to cloud<div class="progress-wrap" style="width:50px;margin-left:4px"><div class="progress-bar" style="background:linear-gradient(90deg,#0d9488,#2dd4bf)"></div></div></span>`,
    pending:     `<span class="badge badge-pending"><span class="dot dot-pending"></span>Pending</span>`,
    failed:      `<span class="badge badge-failed" title="${escHtml(d.error||'')}"><span class="dot dot-failed"></span>Failed</span>`,
  }[d.status] || `<span class="badge">${d.status}</span>`;

  const date = new Date(d.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  const actions = d.status === 'done' ? `
    <button class="act-btn play" title="Play video" onclick="openPlayer('${d.id}','${escHtml((d.title||'').replace(/'/g,"\\'"))}','${d.format||''}')">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg>
    </button>
    <button class="act-btn save" title="Save to device" onclick="saveFile('${d.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </button>
    <button class="act-btn del" title="Delete" onclick="deleteDownload('${d.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/></svg>
    </button>` :
    `<button class="act-btn del" title="Delete" onclick="deleteDownload('${d.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/></svg>
    </button>`;

  return `<tr>
    <td>
      <div style="font-size:0.85rem;font-weight:500;color:var(--text);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title ? escHtml(d.title) : '<span style="color:var(--subtle);font-style:italic">Processing…</span>'}</div>
      <div style="font-size:0.75rem;color:var(--subtle);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${escHtml(d.url)}</div>
    </td>
    <td>${statusHtml}</td>
    <td><span style="font-size:0.75rem;color:var(--muted);font-weight:500;background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:5px">${(d.format||'—').toUpperCase()}</span></td>
    <td style="font-size:0.78rem;color:var(--subtle);white-space:nowrap">${date}</td>
    <td style="text-align:right;white-space:nowrap">${actions}</td>
  </tr>`;
}

async function deleteDownload(id) {
  const ok = await showConfirm({
    title:   'Delete download?',
    message: 'This will remove the record and delete the file from disk. This cannot be undone.',
    okLabel: 'Delete', okStyle: 'danger',
  });
  if (!ok) return;
  await api(`/api/downloads/${id}`, { method: 'DELETE' });
  showToast('Download deleted', 'success');
  loadRecent();
  if (document.getElementById('pageHistory').style.display !== 'none') loadHistory();
}

async function saveFile(id) {
  showToast('Preparing file…', 'info');
  const res = await api(`/api/downloads/${id}/file`);
  if (!res || !res.ok) { showToast('File not found on disk', 'error'); return; }
  const blob = await res.blob();
  const cd   = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'video.mp4';
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' })
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  URL.revokeObjectURL(url);
  showToast('Saved to device!', 'success');
}

// ═══════════════════════════════════════════════════════════════
// Video Player
// ═══════════════════════════════════════════════════════════════
async function openPlayer(id, title, format) {
  activeVideoId = id;
  const unsupported = ['mkv','avi','flv','wmv'];
  const fmt   = (format || '').toLowerCase();
  const hint  = document.getElementById('videoHint');
  const player = document.getElementById('videoPlayer');

  hint.style.color = 'var(--subtle)';
  hint.innerHTML = 'Use the controls to play, pause, and seek';

  if (unsupported.includes(fmt)) {
    hint.innerHTML = `<span style="color:#fbbf24">⚠ ${fmt.toUpperCase()} may not play in all browsers — use Save to device instead.</span>`;
  }
  player.onerror = () => {
    hint.innerHTML = `<span style="color:#f87171">⚠ Browser can't decode this format. Click <b>Save to device</b> to watch in VLC.</span>`;
  };

  document.getElementById('videoTitle').textContent = title || 'Video';
  document.getElementById('videoMeta').textContent  = format ? `${format.toUpperCase()} · streaming from server` : 'Streaming from server';

  const streamToken = await getToken();
  player.src = `/api/downloads/${id}/file?token=${encodeURIComponent(streamToken)}`;
  player.load();

  const modal = document.getElementById('videoModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePlayer() {
  const player = document.getElementById('videoPlayer');
  player.pause(); player.src = '';
  document.getElementById('videoModal').classList.remove('open');
  document.body.style.overflow = '';
  activeVideoId = null;
}

function handleModalClick(e) {
  if (e.target === document.getElementById('videoModal')) closePlayer();
}

function saveCurrentFile() { if (activeVideoId) saveFile(activeVideoId); }

document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeVideoId) closePlayer(); });

// ═══════════════════════════════════════════════════════════════
// Polling
// ═══════════════════════════════════════════════════════════════
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const res = await api('/api/downloads');
    if (!res) return;
    const data = await res.json();
    const hasActive = data.some(d => ['pending','downloading','converting','uploading'].includes(d.status));
    updateStats(data);
    if (document.getElementById('pageDownloads').style.display !== 'none') loadRecent();
    if (document.getElementById('pageHistory').style.display   !== 'none') loadHistory();
    if (!hasActive) { clearInterval(pollTimer); pollTimer = null; }
  }, 3000);
}

// ═══════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════
async function loadAdmin() {
  const [statsRes, usersRes] = await Promise.all([api('/api/admin/stats'), api('/api/admin/users')]);
  if (statsRes?.ok) {
    const s = await statsRes.json();
    document.getElementById('adm-users').textContent = s.total_users;
    document.getElementById('adm-total').textContent = s.total_downloads;
    document.getElementById('adm-done').textContent  = s.by_status?.done   || 0;
    document.getElementById('adm-fail').textContent  = s.by_status?.failed || 0;
  }
  if (usersRes?.ok) {
    const users = await usersRes.json();
    document.getElementById('adminUsers').innerHTML = users.length ? `
      <table class="tbl">
        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td style="font-weight:600;font-size:0.85rem;color:var(--text)">${escHtml(u.username)}</td>
            <td style="font-size:0.78rem;color:var(--muted)">${escHtml(u.email)}</td>
            <td><span style="font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:5px;background:${u.role==='admin'?'rgba(124,58,237,0.15)':'rgba(59,130,246,0.12)'};color:${u.role==='admin'?'#a78bfa':'#60a5fa'}">${u.role}</span></td>
            <td><span style="font-weight:700;padding:2px 8px;border-radius:5px;background:${u.is_active?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.08)'};color:${u.is_active?'#34d399':'#f87171'};font-size:0.72rem">${u.is_active?'Active':'Disabled'}</span></td>
            <td style="font-size:0.78rem;color:var(--subtle)">${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
            <td style="text-align:right">${u.id !== currentUser.id ? `
              <button class="act-btn" title="Toggle role" onclick="toggleRole('${u.id}','${u.role}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="17,1 21,5 17,9"/><path d="M3,11V9a4,4,0,0,1,4-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21,13v2a4,4,0,0,1-4,4H3"/></svg>
              </button>
              <button class="act-btn ${u.is_active?'del':''}" title="${u.is_active?'Disable':'Enable'}" onclick="toggleActive('${u.id}',${u.is_active})">
                ${u.is_active ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20,6 9,17 4,12"/></svg>'}
              </button>` : '<span style="font-size:0.72rem;color:var(--subtle)">you</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">No users</div></div>`;
  }
}

async function loadAdminDownloads() {
  const res = await api('/api/admin/downloads');
  if (!res?.ok) return;
  const items = await res.json();
  document.getElementById('adminAllDl').innerHTML = items.length ? `
    <table class="tbl">
      <thead><tr><th>User</th><th>Title / URL</th><th>Status</th><th>Date</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${items.map(d => `
        <tr>
          <td style="font-size:0.78rem;color:var(--muted)">${escHtml(d.username)}</td>
          <td>
            <div style="font-size:0.83rem;font-weight:500;color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title ? escHtml(d.title) : '<span style="color:var(--subtle);font-style:italic">—</span>'}</div>
            <div style="font-size:0.72rem;color:var(--subtle);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(d.url)}</div>
          </td>
          <td><span class="badge badge-${d.status==='done'?'done':d.status==='downloading'?'dl':d.status==='pending'?'pending':'failed'}">${d.status}</span></td>
          <td style="font-size:0.78rem;color:var(--subtle)">${new Date(d.created_at).toLocaleDateString('en-GB')}</td>
          <td style="text-align:right"><button class="act-btn del" onclick="adminDelDl('${d.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/></svg></button></td>
        </tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">No downloads found</div></div>`;
}

async function toggleRole(uid, current) {
  const next = current === 'admin' ? 'user' : 'admin';
  const ok = await showConfirm({
    title:   `Change role to "${next}"?`,
    message: next === 'admin'
      ? 'This user will gain full admin access to all users and downloads.'
      : 'This user will lose admin privileges and return to a regular account.',
    okLabel: 'Change role', okStyle: 'primary',
  });
  if (!ok) return;
  await api(`/api/admin/users/${uid}/role`, { method:'PUT', body: JSON.stringify({ role: next }) });
  showToast(`Role changed to ${next}`, 'success');
  loadAdmin();
}

async function toggleActive(uid, current) {
  const ok = await showConfirm({
    title:   current ? 'Disable this account?' : 'Enable this account?',
    message: current
      ? 'The user will be immediately signed out and blocked from logging in.'
      : 'The user will regain full access to their account.',
    okLabel: current ? 'Disable' : 'Enable',
    okStyle: current ? 'danger' : 'primary',
  });
  if (!ok) return;
  await api(`/api/admin/users/${uid}/active`, { method:'PUT', body: JSON.stringify({ is_active: !current }) });
  showToast(current ? 'Account disabled' : 'Account enabled', 'success');
  loadAdmin();
}

async function adminDelDl(id) {
  const ok = await showConfirm({
    title: 'Delete download?',
    message: 'This will permanently remove this download record from the system.',
    okLabel: 'Delete', okStyle: 'danger',
  });
  if (!ok) return;
  await api(`/api/admin/downloads/${id}`, { method:'DELETE' });
  showToast('Deleted', 'success');
  loadAdmin(); loadAdminDownloads();
}

function switchAdminTab(tab) {
  ['tabUsers','tabAllDl'].forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById('adminUsers').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('adminAllDl').style.display = tab === 'allDl' ? 'block' : 'none';
  document.getElementById(tab === 'users' ? 'tabUsers' : 'tabAllDl').classList.add('active');
  if (tab === 'allDl') loadAdminDownloads();
}

// ═══════════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════════
function showToast(msg, type = 'success') {
  const wrap  = document.getElementById('toastWrap');
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span style="font-weight:700;font-size:1rem">${icons[type]||'•'}</span><span style="flex:1">${escHtml(msg)}</span>`;
  wrap.appendChild(toast);
  gsap.fromTo(toast, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
  setTimeout(() => {
    gsap.to(toast, { x: 40, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => toast.remove() });
  }, 3200);
}

// ═══════════════════════════════════════════════════════════════
// Utils
// ═══════════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════
// Custom confirm modal
// ═══════════════════════════════════════════════════════════════
let _confirmResolve = null;

function showConfirm({ title = 'Are you sure?', message = '', okLabel = 'Confirm', okStyle = 'danger' } = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent   = message;

    const okBtn    = document.getElementById('confirmOkBtn');
    const iconWrap = document.getElementById('confirmIconWrap');
    const icon     = document.getElementById('confirmIcon');
    okBtn.textContent = okLabel;

    if (okStyle === 'danger') {
      okBtn.style.cssText    = 'padding:9px 18px;border-radius:9px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.15);color:#f87171;font-family:inherit;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.2s';
      iconWrap.style.cssText = 'width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(239,68,68,0.1);color:#f87171';
      icon.style.stroke      = '#f87171';
      okBtn.onmouseover = () => { okBtn.style.background='#ef4444'; okBtn.style.color='#fff'; };
      okBtn.onmouseout  = () => { okBtn.style.background='rgba(239,68,68,0.15)'; okBtn.style.color='#f87171'; };
    } else {
      okBtn.style.cssText    = 'padding:9px 18px;border-radius:9px;border:none;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-family:inherit;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.2s';
      iconWrap.style.cssText = 'width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(124,58,237,0.15);color:#a78bfa';
      icon.style.stroke      = '#a78bfa';
    }

    const overlay = document.getElementById('confirmOverlay');
    const box     = document.getElementById('confirmBox');
    overlay.style.pointerEvents  = 'all';
    overlay.style.background     = 'rgba(0,0,0,0.75)';
    overlay.style.backdropFilter = 'blur(6px)';
    box.style.transform = 'scale(1) translateY(0)';
    box.style.opacity   = '1';
    document.body.style.overflow = 'hidden';
  });
}

function resolveConfirm(result) {
  const overlay = document.getElementById('confirmOverlay');
  const box     = document.getElementById('confirmBox');
  box.style.transform = 'scale(0.93) translateY(8px)';
  box.style.opacity   = '0';
  setTimeout(() => {
    overlay.style.pointerEvents  = 'none';
    overlay.style.background     = 'rgba(0,0,0,0)';
    overlay.style.backdropFilter = 'blur(0px)';
    document.body.style.overflow = '';
  }, 250);
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

// Close confirm on backdrop click / Escape
document.getElementById('confirmOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirmOverlay')) resolveConfirm(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _confirmResolve) resolveConfirm(false);
});

// ── Clerk bootstrap ──────────────────────────────────────────────────────────
(async () => {
  await window.Clerk.load();
  window.__clerk = window.Clerk;
  if (!window.Clerk.user) { window.location.href = '/login'; return; }
  await init();
})();
