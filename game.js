'use strict';
/* 小壁虎大冒险 — 上滑跳 / 下滑爬 / 左右移动，躲斧头骷髅，吃萤火虫 */

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const scoreEl = document.getElementById('score');
const heartsEl = document.getElementById('hearts');
const menuEl = document.getElementById('menu');
const overEl = document.getElementById('over');
const flashEl = document.getElementById('flash');
const muteBtn = document.getElementById('mute');

let W = 0, H = 0, gy = 0, DPR = 1;

// ---------- 玩家 ----------
const player = {
  x: 130, tx: 130, py: 0, vy: 0,
  onGround: true, crawl: 0, inv: 0,
  hearts: 3, run: 0,
  xMin: 70, xMax: 400,
};
const PW = 56, PH = 74, PH_CRAWL = 38;
const GRAV = 2800, JUMP_V = 1080, CRAWL_TIME = 1.15;

// ---------- 游戏状态 ----------
let state = 'menu'; // menu | play | over
let entities = [];  // {kind, x, ...}
let particles = [];
let clouds = [];
let tufts = [];
let speed = 300, elapsed = 0, score = 0, spawnT = 1.2;
let shake = 0, bgX = 0, duneX1 = 0, duneX2 = 0;
let best = parseInt(localStorage.getItem('geckoBest') || '0', 10) || 0;
let muted = localStorage.getItem('geckoMuted') === '1';

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  gy = Math.round(H * 0.8);
  player.xMin = 70;
  player.xMax = Math.max(220, W * 0.72);
  player.x = Math.min(Math.max(player.x, player.xMin), player.xMax);
  player.tx = Math.min(Math.max(player.tx, player.xMin), player.xMax);
  initScenery();
}
window.addEventListener('resize', resize);

// ---------- 音效 ----------
let AC = null;
function initAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === 'suspended') AC.resume();
}
function tone(f0, f1, dur, type, vol) {
  if (muted || !AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  jump() { tone(280, 620, 0.14, 'square', 0.07); },
  eat()  { tone(880, 1560, 0.1, 'sine', 0.1); },
  hit()  { tone(220, 55, 0.28, 'sawtooth', 0.14); },
  over() { tone(400, 120, 0.5, 'triangle', 0.12); setTimeout(() => tone(300, 90, 0.5, 'triangle', 0.1), 220); },
};
muteBtn.textContent = muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  muted = !muted;
  localStorage.setItem('geckoMuted', muted ? '1' : '0');
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

// ---------- 输入 ----------
function doJump() {
  if (state !== 'play') return;
  initAudio();
  if (player.onGround) {
    player.crawl = 0;
    player.vy = JUMP_V;
    player.onGround = false;
    sfx.jump();
    dust(player.x, gy, 6);
  }
}
function doDown() {
  if (state !== 'play') return;
  initAudio();
  if (!player.onGround) {
    player.vy = Math.min(player.vy, -1700); // 猛地往下
    player.slam = true;
  } else {
    player.crawl = CRAWL_TIME;
  }
}
function moveFwd() { if (state === 'play') player.tx = Math.min(player.xMax, player.tx + 115); }
function moveBack() { if (state === 'play') player.tx = Math.max(player.xMin, player.tx - 115); }

let tsx = 0, tsy = 0, tracking = false;
function onDown(x, y) { tsx = x; tsy = y; tracking = true; }
function onUp(x, y) {
  if (!tracking) return;
  tracking = false;
  const dx = x - tsx, dy = y - tsy;
  if (Math.hypot(dx, dy) < 26) { doJump(); return; } // 轻点 = 跳
  if (Math.abs(dx) > Math.abs(dy)) { dx > 0 ? moveFwd() : moveBack(); }
  else { dy < 0 ? doJump() : doDown(); }
}
cv.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
cv.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; onUp(t.clientX, t.clientY); });
cv.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
cv.addEventListener('mouseup', (e) => onUp(e.clientX, e.clientY));
document.addEventListener('touchmove', (e) => { if (state === 'play') e.preventDefault(); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'ArrowUp' || e.code === 'Space') { e.preventDefault(); doJump(); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); doDown(); }
  else if (e.code === 'ArrowLeft') moveBack();
  else if (e.code === 'ArrowRight') moveFwd();
  else if (e.code === 'Enter' && state !== 'play') startGame();
});

// ---------- 场景 ----------
function initScenery() {
  clouds = [];
  for (let i = 0; i < 6; i++) clouds.push({ x: Math.random() * W, y: 30 + Math.random() * H * 0.3, s: 0.6 + Math.random() * 0.9, v: 8 + Math.random() * 14 });
  tufts = [];
  for (let i = 0; i < 26; i++) tufts.push({ x: Math.random() * (W + 200), s: 0.7 + Math.random() * 0.7 });
}

// ---------- 生成 ----------
function spawnPattern() {
  const x = W + 90;
  const minGap = 430;
  // 用现存实体里最靠右的位置来判断间距（之前这里有个 bug：只刷第一只障碍物）
  let rightMost = -9999;
  for (const e of entities) if (e.x > rightMost) rightMost = e.x;
  if (x - rightMost < minGap) { spawnT = 0.18; return; }
  const r = Math.random();
  if (r < 0.30) {
    entities.push({ kind: 'axe', x, spin: 0 });
  } else if (r < 0.55) {
    entities.push({ kind: 'skull', x, tall: Math.random() < 0.65, ph: Math.random() * 6 });
  } else if (r < 0.76) {
    const top = Math.random() < 0.5;
    entities.push({ kind: 'web', x, top });
  } else {
    // 萤火虫弧线
    const baseH = 90 + Math.random() * 130;
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * Math.PI;
      entities.push({ kind: 'fly', x: x + i * 46, h: baseH + Math.sin(a) * 90, ph: Math.random() * 6 });
    }
  }
  spawnT = (minGap / speed) * (1 + Math.random() * 0.55);
}

// ---------- 粒子 ----------
function dust(x, y, n) {
  for (let i = 0; i < n; i++) {
    particles.push({ x: x + (Math.random() - 0.5) * 30, y: y - Math.random() * 8,
      vx: -60 - Math.random() * 80, vy: -40 - Math.random() * 60,
      life: 0.5, max: 0.5, size: 3 + Math.random() * 4, color: '210,170,110' });
  }
}
function sparkle(x, y) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 140;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.5, max: 0.5, size: 2 + Math.random() * 3, color: '255,235,120' });
  }
}

// ---------- 碰撞 ----------
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function playerRect() {
  const crawling = player.crawl > 0;
  const ph = crawling ? PH_CRAWL : PH;
  return { x: player.x - PW / 2 + 6, y: gy - player.py - ph, w: PW - 12, h: ph };
}
function hitTest(e) {
  const pr = playerRect();
  const shrink = 5;
  if (e.kind === 'axe') {
    const r = { x: e.x - 24 + shrink, y: gy - 52 + shrink, w: 48 - shrink * 2, h: 52 - shrink };
    return rectsOverlap(pr, r);
  }
  if (e.kind === 'skull') {
    const bob = Math.sin(e.ph) * 4;
    const heads = e.tall ? [90, 185] : [90];
    for (const hh of heads) {
      const r = { x: e.x - 20, y: gy - hh - 25 + bob, w: 40, h: 50 };
      if (rectsOverlap(pr, r)) return true;
    }
    return false;
  }
  if (e.kind === 'web') {
    // 网帘：从 gy-340 到 gy，缺口高度 gapH，缺口中心 gapC（离地高度）
    const gapH = e.top ? 130 : 62;
    const gapC = e.top ? 218 : 31;
    const gapTop = gapC + gapH / 2, gapBot = gapC - gapH / 2;
    const upper = { x: e.x - 15, y: gy - 340, w: 30, h: 340 - gapTop };
    const lower = { x: e.x - 15, y: gy - gapBot, w: 30, h: gapBot };
    return rectsOverlap(pr, upper) || rectsOverlap(pr, lower);
  }
  return false;
}

// ---------- 受伤 / 结束 ----------
function hurt() {
  player.hearts--;
  player.inv = 1.6;
  shake = 0.4;
  sfx.hit();
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 160);
  heartsEl.textContent = '❤️'.repeat(Math.max(0, player.hearts)) + '🤍'.repeat(Math.max(0, 3 - player.hearts));
  dust(player.x, gy - player.py - 30, 12);
  if (player.hearts <= 0) gameOver();
}
function gameOver() {
  state = 'over';
  sfx.over();
  const fs = Math.floor(score);
  const isBest = fs > best;
  if (isBest) { best = fs; localStorage.setItem('geckoBest', String(best)); }
  document.getElementById('finalScore').textContent = fs;
  document.getElementById('bestOver').textContent = best;
  document.getElementById('newBest').classList.toggle('hidden', !isBest);
  setTimeout(() => overEl.classList.remove('hidden'), 600);
}
function startGame() {
  initAudio();
  state = 'play';
  entities = []; particles = [];
  speed = 300; elapsed = 0; score = 0; spawnT = 1.0;
  player.x = Math.min(130, player.xMax); player.tx = player.x;
  player.py = 0; player.vy = 0; player.onGround = true;
  player.crawl = 0; player.inv = 0; player.hearts = 3;
  heartsEl.textContent = '❤️❤️❤️';
  menuEl.classList.add('hidden');
  overEl.classList.add('hidden');
}
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', startGame);
document.getElementById('bestMenu').textContent = best;

// ---------- 更新 ----------
function update(dt) {
  elapsed += dt;
  speed = Math.min(560, 300 + elapsed * 7);
  score += speed * dt * 0.05;

  // 玩家 x
  player.tx = Math.min(Math.max(player.tx, player.xMin), player.xMax);
  player.x += (player.tx - player.x) * Math.min(1, dt * 12);

  // 跳跃物理
  if (!player.onGround) {
    player.vy -= GRAV * dt;
    player.py += player.vy * dt;
    if (player.py <= 0) {
      player.py = 0; player.vy = 0; player.onGround = true;
      dust(player.x, gy, 5);
      if (player.slam) { player.crawl = CRAWL_TIME; player.slam = false; }
    }
  }
  if (player.crawl > 0) player.crawl -= dt;
  if (player.inv > 0) player.inv -= dt;
  if (player.onGround && Math.abs(player.tx - player.x) < 200) player.run += dt * 13;
  if (shake > 0) shake -= dt;

  // 生成
  spawnT -= dt;
  if (spawnT <= 0) spawnPattern();

  // 实体
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    e.x -= speed * dt;
    if (e.kind === 'axe') e.spin += dt * 9;
    if (e.kind === 'skull' || e.kind === 'fly') e.ph += dt * 3;
    if (e.x < -140) { entities.splice(i, 1); continue; }
    if (e.kind === 'fly' && !e.taken) {
      const fx = e.x, fy = gy - e.h + Math.sin(e.ph) * 6;
      const dx = fx - player.x, dy = fy - (gy - player.py - 30);
      if (dx * dx + dy * dy < 42 * 42) {
        e.taken = true; score += 10; sfx.eat();
        sparkle(fx, fy);
        entities.splice(i, 1); continue;
      }
    } else if (e.kind !== 'fly' && player.inv <= 0 && hitTest(e)) {
      hurt();
    }
  }

  // 粒子
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
  }

  // 背景
  bgX -= speed * dt * 0.15;
  duneX1 -= speed * dt * 0.3;
  duneX2 -= speed * dt * 0.55;
  for (const c of clouds) { c.x -= (c.v + speed * 0.1) * dt; if (c.x < -160) { c.x = W + 120; c.y = 30 + Math.random() * H * 0.3; } }
  for (const t of tufts) { t.x -= speed * dt; if (t.x < -30) t.x = W + Math.random() * 200; }

  scoreEl.textContent = Math.floor(score);
}

// ---------- 绘制 ----------
function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.beginPath();
  ctx.ellipse(x, y, 44 * s, 18 * s, 0, 0, 7);
  ctx.ellipse(x - 28 * s, y + 6 * s, 26 * s, 13 * s, 0, 0, 7);
  ctx.ellipse(x + 30 * s, y + 5 * s, 28 * s, 14 * s, 0, 0, 7);
  ctx.fill();
}
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, '#5fb8e6'); g.addColorStop(0.65, '#b8e6f8'); g.addColorStop(1, '#fdf3da');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy + 2);
  // 太阳
  ctx.fillStyle = 'rgba(255,236,160,.9)';
  ctx.beginPath(); ctx.arc(W - 80, 90, 46, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffdf6b';
  ctx.beginPath(); ctx.arc(W - 80, 90, 34, 0, 7); ctx.fill();
  for (const c of clouds) drawCloud(c.x, c.y, c.s);
  // 远山
  ctx.fillStyle = '#e3c078';
  ctx.beginPath(); ctx.moveTo(0, gy);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, gy - 60 - Math.sin((x + duneX1) * 0.008) * 34 - Math.sin((x + duneX1) * 0.02) * 10);
  ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d4a556';
  ctx.beginPath(); ctx.moveTo(0, gy);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, gy - 26 - Math.sin((x + duneX2) * 0.012) * 20);
  ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
  // 地面
  ctx.fillStyle = '#a9743f'; ctx.fillRect(0, gy, W, H - gy);
  ctx.fillStyle = '#8f5f31'; ctx.fillRect(0, gy, W, 8);
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  for (let x = 0; x < W; x += 46) {
    const ox = ((x + bgX * 4) % (W + 60) + W + 60) % (W + 60) - 30;
    ctx.fillRect(ox, gy + 22 + (x % 3) * 14, 16, 5);
  }
  // 草
  ctx.strokeStyle = '#5d9c4a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const t of tufts) {
    const bx = t.x, by = gy + 12;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - 6 * t.s, by - 14 * t.s, bx - 10 * t.s, by - 18 * t.s);
    ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 2 * t.s, by - 16 * t.s, bx + 3 * t.s, by - 22 * t.s);
    ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 8 * t.s, by - 12 * t.s, bx + 12 * t.s, by - 16 * t.s);
    ctx.stroke();
  }
}
function drawGecko() {
  const crawling = player.crawl > 0;
  const h = crawling ? PH_CRAWL : PH;
  const feetY = gy - player.py;
  ctx.save();
  ctx.translate(player.x, feetY);
  if (player.inv > 0 && Math.floor(player.inv * 12) % 2 === 0) ctx.globalAlpha = 0.35;
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(0, 4, 30, 7, 0, 0, 7); ctx.fill();
  const wag = Math.sin(elapsed * 6) * 6;
  // 尾巴
  ctx.strokeStyle = '#3d8b4f'; ctx.lineWidth = crawling ? 10 : 13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-20, -14);
  ctx.quadraticCurveTo(-44, -20 + wag, -58, -34 + wag * 1.6); ctx.stroke();
  // 腿
  const legSwing = player.onGround && !crawling ? Math.sin(player.run) * 9 : 0;
  ctx.strokeStyle = '#3d8b4f'; ctx.lineWidth = 9;
  const legY = crawling ? -8 : -26;
  const spread = crawling ? 16 : 8;
  ctx.beginPath();
  ctx.moveTo(-12, legY); ctx.lineTo(-12 - spread, 0 + (crawling ? 0 : legSwing));
  ctx.moveTo(14, legY); ctx.lineTo(14 + spread, 0 + (crawling ? 0 : -legSwing));
  ctx.stroke();
  // 身体
  const bodyGrad = ctx.createLinearGradient(0, -h, 0, 0);
  bodyGrad.addColorStop(0, '#6fce7d'); bodyGrad.addColorStop(1, '#4aa85e');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  if (crawling) ctx.ellipse(2, -h / 2, 32, h / 2, 0, 0, 7);
  else ctx.ellipse(0, -h / 2 - 4, 25, h / 2, 0.08, 0, 7);
  ctx.fill();
  // 肚皮
  ctx.fillStyle = '#dff5d8';
  ctx.beginPath(); ctx.ellipse(10, crawling ? -10 : -30, 12, crawling ? 8 : 20, 0.15, 0, 7); ctx.fill();
  // 背纹
  ctx.fillStyle = '#3d8b4f';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(-6 - i * 2, -h + 14 + i * (crawling ? 6 : 16), 3.4, 0, 7); ctx.fill();
  }
  // 头 + 眼睛
  const hy = crawling ? -h + 6 : -h + 2;
  ctx.fillStyle = '#6fce7d';
  ctx.beginPath(); ctx.arc(20, hy, crawling ? 15 : 19, 0, 7); ctx.fill();
  const eyeY = hy - 10, blinkH = (Math.sin(elapsed * 0.7) > 0.985) ? 2 : 1;
  for (const ex of [13, 28]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex, eyeY, 8, 8 * blinkH, 0, 0, 7); ctx.fill();
    if (blinkH === 1) {
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(ex + 2.5, eyeY + 1, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex + 3.6, eyeY - 0.4, 1.3, 0, 7); ctx.fill();
    }
  }
  // 微笑 + 腮红
  ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(24, hy + 8, 7, 0.25, Math.PI - 0.6); ctx.stroke();
  ctx.fillStyle = 'rgba(255,150,150,.55)';
  ctx.beginPath(); ctx.arc(33, hy + 6, 4, 0, 7); ctx.fill();
  ctx.restore();
}
function drawEntities() {
  for (const e of entities) {
    if (e.kind === 'axe') {
      // 深色底盘 + 放大，让斧头在亮背景上更醒目
      ctx.fillStyle = 'rgba(46,28,28,0.88)';
      ctx.beginPath(); ctx.arc(e.x, gy - 26, 42, 0, 7); ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = '#ff5252';
      ctx.beginPath(); ctx.arc(e.x, gy - 26, 42, 0, 7); ctx.stroke();
      ctx.save();
      ctx.translate(e.x, gy - 26);
      ctx.rotate(e.spin);
      ctx.font = '72px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🪓', 0, 2);
      ctx.restore();
    } else if (e.kind === 'skull') {
      const bob = Math.sin(e.ph) * 4;
      const heads = e.tall ? [90, 185] : [90];
      for (const hh of heads) {
        const sy = gy - hh + bob;
        ctx.fillStyle = 'rgba(28,28,38,0.88)';
        ctx.beginPath(); ctx.arc(e.x, sy, 44, 0, 7); ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#f5f5f5';
        ctx.beginPath(); ctx.arc(e.x, sy, 44, 0, 7); ctx.stroke();
        ctx.font = '74px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💀', e.x, sy + 2);
      }
    } else if (e.kind === 'web') {
      const x0 = e.x - 15;
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5;
      const gapH = e.top ? 130 : 62, gapC = e.top ? 218 : 31;
      const gapTopY = gy - (gapC + gapH / 2), gapBotY = gy - (gapC - gapH / 2);
      // 网帘竖线（缺口处断开）
      for (const lx of [x0, x0 + 15, x0 + 30]) {
        ctx.beginPath(); ctx.moveTo(lx, gy - 340); ctx.lineTo(lx, gapTopY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, gapBotY); ctx.lineTo(lx, gy); ctx.stroke();
      }
      // 横向蛛丝
      for (let wy = gy - 330; wy < gy; wy += 34) {
        if (wy > gapTopY - 4 && wy < gapBotY + 4) continue;
        ctx.beginPath(); ctx.moveTo(x0 - 2, wy); ctx.lineTo(x0 + 32, wy); ctx.stroke();
      }
      // 缺口提示箭头
      ctx.font = '30px serif'; ctx.textAlign = 'center';
      ctx.fillText(e.top ? '⬆️' : '⬇️', e.x, (gapTopY + gapBotY) / 2 + 8);
    } else if (e.kind === 'fly') {
      const fy = gy - e.h + Math.sin(e.ph) * 6;
      const pulse = 1 + Math.sin(e.ph * 2.3) * 0.18;
      const gl = ctx.createRadialGradient(e.x, fy, 2, e.x, fy, 44 * pulse);
      gl.addColorStop(0, 'rgba(255,246,170,.95)');
      gl.addColorStop(0.35, 'rgba(255,214,64,.6)');
      gl.addColorStop(1, 'rgba(255,214,64,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(e.x, fy, 44 * pulse, 0, 7); ctx.fill();
      // 实心虫身 + 深色描边，在亮背景上也看得清
      ctx.fillStyle = '#7a5200';
      ctx.beginPath(); ctx.arc(e.x, fy, 14, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe94d';
      ctx.beginPath(); ctx.arc(e.x, fy, 10.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#fffde8';
      ctx.beginPath(); ctx.arc(e.x - 3, fy - 3.5, 3.6, 0, 7); ctx.fill();
    }
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.fillStyle = `rgba(${p.color},${(p.life / p.max).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
  }
}
function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake * 3, (Math.random() - 0.5) * 8 * shake * 3);
  drawBackground();
  drawEntities();
  if (state !== 'over') drawGecko();
  drawParticles();
  ctx.restore();
}

// ---------- 主循环 ----------
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (state === 'play') update(dt);
  else { // 菜单/结算也让背景轻轻动
    for (const c of clouds) { c.x -= c.v * dt; if (c.x < -160) { c.x = W + 120; c.y = 30 + Math.random() * H * 0.3; } }
  }
  render();
}
document.addEventListener('visibilitychange', () => { lastT = performance.now(); });

resize();
document.getElementById('bestMenu').textContent = best;
requestAnimationFrame(loop);
