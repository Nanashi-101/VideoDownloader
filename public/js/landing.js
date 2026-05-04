gsap.registerPlugin(ScrollTrigger);

// Navbar scroll effect
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('nav-scrolled', window.scrollY > 40);
});

// Hero entrance
const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
heroTl
  .from('#heroBadge',  { y: 30, opacity: 0, duration: 0.7 })
  .from('#heroTitle',  { y: 40, opacity: 0, duration: 0.8 }, '-=0.4')
  .from('#heroSub',    { y: 30, opacity: 0, duration: 0.7 }, '-=0.5')
  .from('#heroCta',    { y: 25, opacity: 0, duration: 0.7 }, '-=0.5')
  .from('#heroMockup', { y: 50, opacity: 0, duration: 1, ease: 'power2.out' }, '-=0.4');

// Floating orbs
gsap.to('#orb1', { y: -30, x: 20,  duration: 8,  repeat: -1, yoyo: true, ease: 'sine.inOut' });
gsap.to('#orb2', { y: 25,  x: -15, duration: 10, repeat: -1, yoyo: true, ease: 'sine.inOut' });
gsap.to('#orb3', { y: -20, x: 10,  duration: 7,  repeat: -1, yoyo: true, ease: 'sine.inOut' });

// Stats counter
document.querySelectorAll('.counter').forEach(el => {
  const target = parseInt(el.dataset.target);
  ScrollTrigger.create({
    trigger: el, start: 'top 85%', once: true,
    onEnter: () => {
      gsap.to({ val: 0 }, {
        val: target, duration: 1.5, ease: 'power2.out',
        onUpdate: function() { el.textContent = Math.round(this.targets()[0].val) + '+'; }
      });
    }
  });
});

// Section badges & titles
gsap.utils.toArray('.section-badge,.section-badge2,.about-badge').forEach(el => {
  gsap.from(el, { y: 20, opacity: 0, duration: 0.6, ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
});
gsap.utils.toArray('.section-title,.section-title2,.about-title,.cta-title').forEach(el => {
  gsap.from(el, { y: 40, opacity: 0, duration: 0.8, ease: 'power3.out',
    scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
});
gsap.utils.toArray('.section-sub,.about-text,.cta-sub').forEach(el => {
  gsap.from(el, { y: 20, opacity: 0, duration: 0.7, ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
});

// Feature rows (slide in from sides)
gsap.utils.toArray('.feat-row').forEach((row, i) => {
  const cols = row.querySelectorAll('.feat-text, .feat-mockup');
  cols.forEach((col, j) => {
    const fromLeft = (i % 2 === 0) ? j === 0 : j === 1;
    gsap.from(col, {
      x: fromLeft ? -60 : 60, opacity: 0, duration: 0.9, ease: 'power3.out',
      delay: j * 0.12,
      scrollTrigger: { trigger: row, start: 'top 80%', once: true }
    });
  });
});

// Feature cards stagger
gsap.from('.feat-card', {
  y: 40, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out',
  scrollTrigger: { trigger: '.feat-card', start: 'top 88%', once: true }
});

// Steps stagger
gsap.from('.step-card', {
  y: 40, opacity: 0, duration: 0.7, stagger: 0.15, ease: 'power3.out',
  scrollTrigger: { trigger: '.step-card', start: 'top 85%', once: true }
});

// About visual
gsap.from('.about-visual > *', {
  x: 40, opacity: 0, duration: 0.7, stagger: 0.15, ease: 'power3.out',
  scrollTrigger: { trigger: '.about-visual', start: 'top 80%', once: true }
});

// CTA card
gsap.from('.cta-card', {
  scale: 0.95, opacity: 0, duration: 0.8, ease: 'power3.out',
  scrollTrigger: { trigger: '.cta-card', start: 'top 85%', once: true }
});

// Mock player waveform
const waveEl = document.getElementById('waveform');
if (waveEl) {
  [40,65,30,80,55,90,35,70,50,85,45,75,60,95,40,70,55,80,35,90,50,65,45,75,30,85,60,70,40,55,80,95,35,65,50,75,45,90,55,70].forEach(h => {
    const b = document.createElement('div');
    b.style.cssText = 'width:3px;flex-shrink:0;border-radius:1px;background:rgba(167,139,250,0.7);height:' + h + '%';
    waveEl.appendChild(b);
  });
}

// Mock player progress ticker
let mockPlaying = true, mockSec = 84;
const totalSec = 212;
const pBar = document.getElementById('progressBar');
const tEl  = document.getElementById('mockCurrentTime');
function fmtTime(s) { return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); }
setInterval(() => {
  if (!mockPlaying) return;
  mockSec = (mockSec + 1) % totalSec;
  if (pBar) pBar.style.width = (mockSec / totalSec * 100) + '%';
  if (tEl)  tEl.textContent  = fmtTime(mockSec);
}, 1000);

window.toggleMockPlayer = function() {
  mockPlaying = !mockPlaying;
  const sym  = mockPlaying ? '⏸' : '▶';
  const btn  = document.getElementById('playPauseBtn');
  const icon = document.getElementById('playerIconText');
  if (btn)  btn.textContent  = sym;
  if (icon) icon.textContent = sym;
};

// Fade in pending row after 2.5s
setTimeout(() => {
  const nr = document.querySelector('.mock-row-new');
  if (nr) nr.style.opacity = '1';
}, 2500);

// Clerk: swap nav/CTA if already signed in
(async () => {
  try {
    await window.Clerk.load();
    if (!window.Clerk.user) return;

    document.getElementById('navAuthButtons').innerHTML =
      '<a href="/dashboard" class="btn-primary text-sm font-semibold px-4 py-2 rounded-lg text-white whitespace-nowrap">Dashboard →</a>';

    const heroPrimary = document.getElementById('heroCtaPrimary');
    if (heroPrimary) { heroPrimary.href = '/dashboard'; heroPrimary.innerHTML = 'Go to Dashboard <span>→</span>'; }

    const bottomCta = document.getElementById('bottomCta');
    if (bottomCta) { bottomCta.href = '/dashboard'; bottomCta.innerHTML = 'Go to Dashboard &rarr;'; }

    const bottomSub = document.getElementById('bottomCtaSub');
    if (bottomSub) bottomSub.style.display = 'none';
  } catch (_) { /* Clerk failed silently */ }
})();
