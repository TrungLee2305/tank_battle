// Multiplayer Tank Battle - Client Side
const socket = io();

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game constants
const ARENA_WIDTH = 1440;
const ARENA_HEIGHT = 840;  // Reduced to fit with header/footer
const TANK_SIZE = 30;

// Pre-rendered static grid (never changes — drawn once, blit every frame)
const gridCanvas = document.createElement('canvas');
gridCanvas.width = ARENA_WIDTH;
gridCanvas.height = ARENA_HEIGHT;
(function () {
    const gctx = gridCanvas.getContext('2d');
    gctx.strokeStyle = '#3a3a3a';
    gctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x <= ARENA_WIDTH; x += gridSize) {
        gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, ARENA_HEIGHT); gctx.stroke();
    }
    for (let y = 0; y <= ARENA_HEIGHT; y += gridSize) {
        gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(ARENA_WIDTH, y); gctx.stroke();
    }
}());

// ----- Tank class rendering helpers -----
// 3 tank classes: 'gun' (Laser Beam ult), 'light' (Speed Demon ult), 'armored' (Ghost Mode ult)
// Each renderer draws a unique body/turret/barrel around (cx, cy) with the given rotation angle and base color.
// The renderer is used both in-game and for the welcome-screen preview cards.
const TANK_CLASSES = ['gun', 'light', 'armored'];

function shadeColor(hex, amount) {
    // amount in [-1, 1]. Positive = lighter, negative = darker.
    const h = (hex || '#32CD32').replace('#', '');
    const num = parseInt(h.length === 3
        ? h.split('').map(c => c + c).join('')
        : h, 16);
    let r = (num >> 16) & 0xff;
    let g = (num >> 8) & 0xff;
    let b = num & 0xff;
    const t = amount < 0 ? 0 : 255;
    const p = Math.abs(amount);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `rgb(${r}, ${g}, ${b})`;
}

function drawTankByClass(ctx, cx, cy, angle, color, tankClass, size, treadPhase) {
    const tankClassSafe = TANK_CLASSES.includes(tankClass) ? tankClass : 'gun';
    const s = size || TANK_SIZE;
    const bodyDark = shadeColor(color, -0.35);
    const bodyLight = shadeColor(color, 0.15);
    const treadColor = '#222222';
    const treadHighlight = '#555555';
    // treadPhase (pixels) makes the tread hash marks scroll while moving
    const phase = treadPhase || 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    if (tankClassSafe === 'gun') {
        // ===== GUN TANK =====
        // Long rectangular body, large round turret, long thick barrel with muzzle brake
        const bodyW = s * 1.05;
        const bodyH = s * 0.85;
        const treadW = bodyW;
        const treadH = s * 0.22;

        // Treads (top & bottom of body in local frame)
        ctx.fillStyle = treadColor;
        ctx.fillRect(-treadW / 2, -bodyH / 2 - treadH * 0.6, treadW, treadH);
        ctx.fillRect(-treadW / 2, bodyH / 2 - treadH * 0.4, treadW, treadH);
        // Tread hash marks (scroll with phase when tank moves)
        ctx.save();
        ctx.beginPath();
        ctx.rect(-treadW / 2, -bodyH / 2 - treadH * 0.7, treadW, treadH + s * 0.1);
        ctx.rect(-treadW / 2, bodyH / 2 - treadH * 0.5, treadW, treadH + s * 0.1);
        ctx.clip();
        ctx.strokeStyle = treadHighlight;
        ctx.lineWidth = 1;
        const gunStep = treadW / 9;
        const gunOffset = ((phase % gunStep) + gunStep) % gunStep;
        for (let i = -5; i <= 5; i++) {
            const x = i * gunStep + gunOffset;
            ctx.beginPath();
            ctx.moveTo(x, -bodyH / 2 - treadH * 0.6);
            ctx.lineTo(x, -bodyH / 2 + treadH * 0.4);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, bodyH / 2 - treadH * 0.4);
            ctx.lineTo(x, bodyH / 2 + treadH * 0.6);
            ctx.stroke();
        }
        ctx.restore();

        // Body with gradient
        const grad = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
        grad.addColorStop(0, bodyLight);
        grad.addColorStop(1, bodyDark);
        ctx.fillStyle = grad;
        ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

        // Turret (large circle)
        const turretR = s * 0.34;
        const turretGrad = ctx.createRadialGradient(-turretR * 0.3, -turretR * 0.3, turretR * 0.2, 0, 0, turretR);
        turretGrad.addColorStop(0, bodyLight);
        turretGrad.addColorStop(1, bodyDark);
        ctx.fillStyle = turretGrad;
        ctx.beginPath();
        ctx.arc(0, 0, turretR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Long thick barrel (pointing right in local frame)
        const barrelLen = s * 0.95;
        const barrelW = s * 0.18;
        ctx.fillStyle = bodyDark;
        ctx.fillRect(turretR * 0.6, -barrelW / 2, barrelLen, barrelW);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(turretR * 0.6, -barrelW / 2, barrelLen, barrelW);

        // Muzzle brake ring
        ctx.fillStyle = '#111';
        const muzzleX = turretR * 0.6 + barrelLen;
        ctx.fillRect(muzzleX - s * 0.1, -barrelW * 0.75, s * 0.1, barrelW * 1.5);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(muzzleX - s * 0.1, -barrelW * 0.75, s * 0.1, barrelW * 1.5);

    } else if (tankClassSafe === 'light') {
        // ===== LIGHT TANK =====
        // Smaller angled body (diamond-ish front), thin short barrel, rear exhaust vents
        const bodyW = s * 0.85;
        const bodyH = s * 0.7;
        const treadW = bodyW * 0.95;
        const treadH = s * 0.16;

        // Thin treads
        ctx.fillStyle = treadColor;
        ctx.fillRect(-treadW / 2, -bodyH / 2 - treadH * 0.4, treadW, treadH);
        ctx.fillRect(-treadW / 2, bodyH / 2 - treadH * 0.6, treadW, treadH);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-treadW / 2, -bodyH / 2 - treadH * 0.5, treadW, treadH + s * 0.08);
        ctx.rect(-treadW / 2, bodyH / 2 - treadH * 0.7, treadW, treadH + s * 0.08);
        ctx.clip();
        ctx.strokeStyle = treadHighlight;
        ctx.lineWidth = 1;
        const lightStep = treadW / 7;
        const lightOffset = ((phase % lightStep) + lightStep) % lightStep;
        for (let i = -4; i <= 4; i++) {
            const x = i * lightStep + lightOffset;
            ctx.beginPath();
            ctx.moveTo(x, -bodyH / 2 - treadH * 0.4);
            ctx.lineTo(x, -bodyH / 2 + treadH * 0.6);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, bodyH / 2 - treadH * 0.6);
            ctx.lineTo(x, bodyH / 2 + treadH * 0.4);
            ctx.stroke();
        }
        ctx.restore();

        // Angled diamond-ish body
        const grad = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
        grad.addColorStop(0, bodyLight);
        grad.addColorStop(1, bodyDark);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(bodyW / 2, 0);                            // front tip
        ctx.lineTo(bodyW * 0.25, -bodyH / 2);                // top-front corner
        ctx.lineTo(-bodyW / 2, -bodyH / 2);                  // top-rear
        ctx.lineTo(-bodyW / 2, bodyH / 2);                   // bottom-rear
        ctx.lineTo(bodyW * 0.25, bodyH / 2);                 // bottom-front corner
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Rear exhaust vents (two small dark stripes on the back)
        ctx.fillStyle = '#111';
        ctx.fillRect(-bodyW / 2 - 1, -bodyH * 0.25, s * 0.12, s * 0.12);
        ctx.fillRect(-bodyW / 2 - 1, bodyH * 0.13, s * 0.12, s * 0.12);

        // Small turret (low profile)
        const turretR = s * 0.24;
        const turretGrad = ctx.createRadialGradient(-turretR * 0.3, -turretR * 0.3, turretR * 0.2, 0, 0, turretR);
        turretGrad.addColorStop(0, bodyLight);
        turretGrad.addColorStop(1, bodyDark);
        ctx.fillStyle = turretGrad;
        ctx.beginPath();
        ctx.arc(0, 0, turretR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Thin short barrel
        const barrelLen = s * 0.65;
        const barrelW = s * 0.1;
        ctx.fillStyle = bodyDark;
        ctx.fillRect(turretR * 0.6, -barrelW / 2, barrelLen, barrelW);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(turretR * 0.6, -barrelW / 2, barrelLen, barrelW);

    } else {
        // ===== ARMORED TANK =====
        // Wider heavy body, thick treads, bolted plates (rivets), short stubby boxy turret
        const bodyW = s * 1.0;
        const bodyH = s * 1.0;
        const treadW = bodyW * 1.05;
        const treadH = s * 0.28;

        // Thick treads
        ctx.fillStyle = treadColor;
        ctx.fillRect(-treadW / 2, -bodyH / 2 - treadH * 0.7, treadW, treadH);
        ctx.fillRect(-treadW / 2, bodyH / 2 - treadH * 0.3, treadW, treadH);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-treadW / 2, -bodyH / 2 - treadH * 0.8, treadW, treadH + s * 0.12);
        ctx.rect(-treadW / 2, bodyH / 2 - treadH * 0.4, treadW, treadH + s * 0.12);
        ctx.clip();
        ctx.strokeStyle = treadHighlight;
        ctx.lineWidth = 1.5;
        const armoredStep = treadW / 11;
        const armoredOffset = ((phase % armoredStep) + armoredStep) % armoredStep;
        for (let i = -6; i <= 6; i++) {
            const x = i * armoredStep + armoredOffset;
            ctx.beginPath();
            ctx.moveTo(x, -bodyH / 2 - treadH * 0.7);
            ctx.lineTo(x, -bodyH / 2 + treadH * 0.3);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, bodyH / 2 - treadH * 0.3);
            ctx.lineTo(x, bodyH / 2 + treadH * 0.7);
            ctx.stroke();
        }
        ctx.restore();

        // Heavy body with gradient
        const grad = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
        grad.addColorStop(0, bodyLight);
        grad.addColorStop(1, bodyDark);
        ctx.fillStyle = grad;
        ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

        // Rivets (small dark circles on 4 corners)
        ctx.fillStyle = '#111';
        const rivetR = s * 0.06;
        const rivetInset = s * 0.14;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
            ctx.beginPath();
            ctx.arc(sx * (bodyW / 2 - rivetInset), sy * (bodyH / 2 - rivetInset), rivetR, 0, Math.PI * 2);
            ctx.fill();
        });

        // Boxy turret
        const turretSize = s * 0.55;
        const turretGrad = ctx.createLinearGradient(0, -turretSize / 2, 0, turretSize / 2);
        turretGrad.addColorStop(0, bodyLight);
        turretGrad.addColorStop(1, bodyDark);
        ctx.fillStyle = turretGrad;
        ctx.fillRect(-turretSize / 2, -turretSize / 2, turretSize, turretSize);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-turretSize / 2, -turretSize / 2, turretSize, turretSize);

        // Short stubby barrel
        const barrelLen = s * 0.6;
        const barrelW = s * 0.22;
        ctx.fillStyle = bodyDark;
        ctx.fillRect(turretSize * 0.4, -barrelW / 2, barrelLen, barrelW);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(turretSize * 0.4, -barrelW / 2, barrelLen, barrelW);
    }

    ctx.restore();
}

// Game state
let myPlayerId = null;
let myPlayerName = null;
let mouseX = 0;
let mouseY = 0;
let currentAngle = 0;
let lastRotateTime = 0;
let gameState = {
    players: [],
    bullets: [],
    terrain: []
};

let lastKilledBy = null;

// Pre-rendered terrain canvas (rebuilt once when terrain data arrives)
let terrainCanvas = null;

function prebuildTerrainCanvas(terrainData) {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = ARENA_WIDTH;
    terrainCanvas.height = ARENA_HEIGHT;
    const tctx = terrainCanvas.getContext('2d');
    tctx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    terrainData.forEach(obj => {
        if (obj.type === 'rampart') {
            tctx.fillStyle = '#666666';
            tctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            tctx.strokeStyle = '#444444';
            tctx.lineWidth = 2;
            tctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            tctx.strokeStyle = '#555555';
            tctx.lineWidth = 1;
            for (let bx = obj.x; bx < obj.x + obj.width; bx += 20) {
                tctx.beginPath(); tctx.moveTo(bx, obj.y); tctx.lineTo(bx, obj.y + obj.height); tctx.stroke();
            }
            for (let by = obj.y; by < obj.y + obj.height; by += 15) {
                tctx.beginPath(); tctx.moveTo(obj.x, by); tctx.lineTo(obj.x + obj.width, by); tctx.stroke();
            }
        } else if (obj.type === 'bush') {
            tctx.fillStyle = 'rgba(34, 139, 34, 0.6)';
            tctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            tctx.strokeStyle = 'rgba(0, 100, 0, 0.8)';
            tctx.lineWidth = 2;
            tctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            tctx.fillStyle = 'rgba(50, 205, 50, 0.4)';
            for (let i = 0; i < 5; i++) {
                tctx.beginPath();
                tctx.arc(obj.x + Math.random() * obj.width, obj.y + Math.random() * obj.height, 8, 0, Math.PI * 2);
                tctx.fill();
            }
        }
    });
}

// Atomic bomb explosion animation
let explosionAnimation = null; // {startTime, duration}

// ===== Effect system (muzzle flash, exhaust, death explosion) =====
// Lightweight particle array drawn every frame in draw()
// Each particle: { x, y, vx, vy, life, maxLife, type, color, size, rot, rotSpeed }
const particles = [];
// Muzzle flashes: { x, y, angle, startTime, duration, color }
const muzzleFlashes = [];
// Previous player snapshot for detecting movement / death between ticks
const prevPlayerState = new Map();
// Accumulated tread scroll distance per player (pixels)
const treadPhaseByPlayer = new Map();

function spawnExhaust(x, y, dirAngle) {
    // A soft gray puff drifting opposite the direction of travel
    const backAngle = dirAngle + Math.PI;
    const spread = (Math.random() - 0.5) * 0.6;
    const speed = 0.3 + Math.random() * 0.4;
    particles.push({
        x: x,
        y: y,
        vx: Math.cos(backAngle + spread) * speed,
        vy: Math.sin(backAngle + spread) * speed,
        life: 500 + Math.random() * 200,
        maxLife: 700,
        type: 'exhaust',
        color: '220, 220, 220',
        size: 3 + Math.random() * 2
    });
}

function spawnMuzzleFlash(x, y, angle, color) {
    muzzleFlashes.push({
        x: x,
        y: y,
        angle: angle,
        startTime: Date.now(),
        duration: 120,
        color: color || '#FFD700'
    });
    // Also spit a few spark particles
    for (let i = 0; i < 5; i++) {
        const sparkAngle = angle + (Math.random() - 0.5) * 0.5;
        const speed = 1.5 + Math.random() * 2.0;
        particles.push({
            x: x + Math.cos(angle) * (TANK_SIZE / 2 + 10),
            y: y + Math.sin(angle) * (TANK_SIZE / 2 + 10),
            vx: Math.cos(sparkAngle) * speed,
            vy: Math.sin(sparkAngle) * speed,
            life: 180,
            maxLife: 180,
            type: 'spark',
            color: '255, 200, 80',
            size: 1.5 + Math.random() * 1.5
        });
    }
}

function spawnDeathExplosion(x, y, color) {
    // Ring-type particle + many debris particles + a few smoke puffs
    particles.push({
        x: x, y: y, vx: 0, vy: 0,
        life: 600, maxLife: 600,
        type: 'ring',
        color: '255, 120, 40',
        size: 5  // starting radius
    });
    // Debris: small rotated rectangles flying outward
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3.5;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            life: 700 + Math.random() * 300,
            maxLife: 1000,
            type: 'debris',
            color: color || '#888888',
            size: 2 + Math.random() * 3,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.4
        });
    }
    // Smoke puffs
    for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 0.4 + Math.random() * 0.8;
        particles.push({
            x: x + Math.cos(a) * 5,
            y: y + Math.sin(a) * 5,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 0.2,
            life: 900 + Math.random() * 400,
            maxLife: 1300,
            type: 'smoke',
            color: '80, 80, 80',
            size: 5 + Math.random() * 4
        });
    }
}

function updateParticles(dtMs) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dtMs;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.type === 'smoke') {
            p.size += 0.08;
            p.vx *= 0.98;
            p.vy *= 0.98;
        } else if (p.type === 'debris') {
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.rot += p.rotSpeed;
        } else if (p.type === 'exhaust') {
            p.size += 0.04;
            p.vx *= 0.97;
            p.vy *= 0.97;
        } else if (p.type === 'ring') {
            p.size += 1.8;  // expand
        } else if (p.type === 'spark') {
            p.vx *= 0.9;
            p.vy *= 0.9;
        }
    }
}

function drawParticles() {
    particles.forEach(p => {
        const alpha = Math.max(0, p.life / p.maxLife);
        if (p.type === 'ring') {
            ctx.save();
            ctx.strokeStyle = `rgba(${p.color}, ${alpha})`;
            ctx.lineWidth = 4;
            ctx.shadowColor = `rgba(${p.color}, ${alpha})`;
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        } else if (p.type === 'debris') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
        } else {
            // smoke, exhaust, spark all use circular soft blobs
            ctx.save();
            ctx.fillStyle = `rgba(${p.color}, ${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });
}

function drawMuzzleFlashes(now) {
    for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
        const f = muzzleFlashes[i];
        const elapsed = now - f.startTime;
        if (elapsed >= f.duration) {
            muzzleFlashes.splice(i, 1);
            continue;
        }
        const progress = elapsed / f.duration;
        const alpha = 1 - progress;
        const flashLen = (TANK_SIZE * 0.55) * (1 - progress * 0.5);
        const flashWidth = TANK_SIZE * 0.28 * (1 - progress * 0.4);

        ctx.save();
        // The flash originates at the end of the barrel
        const muzzleX = f.x + Math.cos(f.angle) * (TANK_SIZE / 2 + 12);
        const muzzleY = f.y + Math.sin(f.angle) * (TANK_SIZE / 2 + 12);
        ctx.translate(muzzleX, muzzleY);
        ctx.rotate(f.angle);

        // Bright core
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 25 * alpha;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, flashLen);
        grad.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
        grad.addColorStop(0.4, `rgba(255, 200, 60, ${alpha * 0.9})`);
        grad.addColorStop(1, `rgba(255, 100, 0, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(flashLen * 0.4, 0, flashLen, flashWidth, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Compare the new gameState.players with prevPlayerState to detect:
//   - movement (spawn exhaust + tread scroll)
//   - death (spawn explosion)
// Called whenever a new game_state arrives.
function detectPlayerEventsAndUpdatePrev(newPlayers) {
    const seen = new Set();
    newPlayers.forEach(p => {
        seen.add(p.id);
        const prev = prevPlayerState.get(p.id);
        if (prev) {
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const movedSq = dx * dx + dy * dy;
            // Moved enough between ticks -> emit exhaust puff
            if (p.alive && movedSq > 1.2) {
                const dirAngle = Math.atan2(dy, dx);
                // Emit exhaust from the rear of the tank
                const rearX = p.x - Math.cos(dirAngle) * (TANK_SIZE / 2);
                const rearY = p.y - Math.sin(dirAngle) * (TANK_SIZE / 2);
                spawnExhaust(rearX, rearY, dirAngle);
            }
            // Death transition: was alive, now not
            if (prev.alive && !p.alive) {
                spawnDeathExplosion(prev.x, prev.y, p.color);
            }
        }
        prevPlayerState.set(p.id, {
            x: p.x, y: p.y, alive: p.alive, health: p.health
        });
    });
    // Clean up players who left
    for (const id of prevPlayerState.keys()) {
        if (!seen.has(id)) prevPlayerState.delete(id);
    }
}

// UI Elements
const welcomeScreen = document.getElementById('welcome-screen');
const deathScreen = document.getElementById('death-screen');
const playerNameInput = document.getElementById('player-name');
const joinButton = document.getElementById('join-button');
const respawnButton = document.getElementById('respawn-button');
const connectionStatus = document.getElementById('connection-status');
const myScore = document.getElementById('my-score');
const myKills = document.getElementById('my-kills');
const myDeaths = document.getElementById('my-deaths');
const myStatus = document.getElementById('my-status');
const myHealthBar = document.getElementById('my-health-bar');
const myHealthText = document.getElementById('my-health-text');
const leaderboard = document.getElementById('leaderboard');
const playersCount = document.getElementById('players-count');
const finalScore = document.getElementById('final-score');
const finalKD = document.getElementById('final-kd');
const killedBy = document.getElementById('killed-by');
const crosshair = document.getElementById('crosshair');
const skillName = document.getElementById('skill-name');
const skillIcon = document.getElementById('skill-icon');
const skillProgressFill = document.getElementById('skill-progress-fill');
const skillProgressText = document.getElementById('skill-progress-text');
const atomicBombPanel = document.getElementById('atomic-bomb-panel');
const bombStatusText = document.getElementById('bomb-status-text');
const bombActionText = document.getElementById('bomb-action-text');

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'connected';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'disconnected';
});

socket.on('connected', (data) => {
    myPlayerId = data.id;
    console.log('My player ID:', myPlayerId);
});

socket.on('game_joined', (data) => {
    console.log('Joined game:', data);
    myPlayerName = data.name;
    if (data.terrain) {
        gameState.terrain = data.terrain;
        prebuildTerrainCanvas(data.terrain);
    }
    welcomeScreen.style.display = 'none';
});

socket.on('player_joined', (data) => {
    console.log('Player joined:', data.name);
    showNotification(`${data.name} joined the battle!`, data.color);
});

socket.on('player_left', (data) => {
    console.log('Player left:', data.name);
    showNotification(`${data.name} left the battle`, '#FF6347');
});

socket.on('game_state', (data) => {
    const preservedTerrain = gameState.terrain;
    detectPlayerEventsAndUpdatePrev(data.players || []);
    gameState = data;
    if (!gameState.terrain && preservedTerrain) {
        gameState.terrain = preservedTerrain;
    }
    updateUI();
    // draw() is handled by the RAF loop — no direct call needed here
});

socket.on('respawned', (data) => {
    console.log('Respawned:', data);
    if (data.id === myPlayerId) {
        deathScreen.style.display = 'none';
    }
});

socket.on('tank_destroyed', (data) => {
    if (data.victim_id === myPlayerId) {
        lastKilledBy = data.killer_name;
    }
    showNotification(`${data.killer_name} destroyed ${data.victim_name}!`, '#FF0000');
});

socket.on('shot_fired', (data) => {
    // Render a muzzle flash at the shooter's barrel tip
    if (typeof data.x === 'number' && typeof data.y === 'number' && typeof data.angle === 'number') {
        spawnMuzzleFlash(data.x, data.y, data.angle);
    }
});

socket.on('supply_collected', (data) => {
    const player = gameState.players.find(p => p.id === data.player_id);
    if (player) {
        let powerupName, color;
        if (data.powerup_type === 'fast_fire') {
            powerupName = 'FAST FIRE ⚡';
            color = '#FFA500';
        } else if (data.powerup_type === 'fan_shot') {
            powerupName = 'FAN SHOT ✦';
            color = '#8A2BE2';
        } else if (data.powerup_type === 'speed_boost') {
            powerupName = 'SPEED BOOST ➤';
            color = '#00FFFF';
        } else { // super_powerup
            powerupName = 'SUPER POWER-UP ★';
            color = '#FFD700';
        }
        showNotification(`${player.name} collected ${powerupName}!`, color);
    }
});

socket.on('captain_selected', (data) => {
    console.log('Captain selected:', data.player_name);
    showNotification(`👑 ${data.player_name} is now the CAPTAIN! (+50% speed, 2-fan bullets, +50% fire rate)`, '#FFD700');
});

socket.on('captain_targeted', (data) => {
    const reward = data.reward || 1000;
    showNotification(`🎯 ${data.player_name} is the CAPTAIN! Kill him to get ${reward} points`, '#FF3030');
});

socket.on('laser_warning', (data) => {
    const player = gameState.players.find(p => p.id === data.player_id);
    if (player) {
        showNotification(`⚠️ ${data.player_name} is preparing LASER BEAM!`, '#FF0000');
    }
});

socket.on('laser_firing', (data) => {
    showNotification(`🔴 ${data.player_name} FIRING LASER BEAM!`, '#FF0000');
});

socket.on('skill_activated', (data) => {
    const player = gameState.players.find(p => p.id === data.player_id);
    if (player) {
        let skillName, skillIcon, color;
        if (data.skill === 'speed_demon') {
            skillName = 'SPEED DEMON';
            skillIcon = '⚡';
            color = '#FFFF00';
        } else if (data.skill === 'laser_beam') {
            skillName = 'LASER BEAM';
            skillIcon = '🔴';
            color = '#FF0000';
        } else if (data.skill === 'ghost_mode') {
            skillName = 'GHOST MODE';
            skillIcon = '👻';
            color = '#9370DB';
        }
        showNotification(`${player.name} activated ${skillName} ${skillIcon}!`, color);
    }
});

socket.on('snake_destroyed', (data) => {
    showNotification(`🐍 ${data.killer_name} DESTROYED the HUGE SNAKE! +500 points!`, '#FFD700');
});

socket.on('bots_spawned', (data) => {
    showNotification(`🤖 ${data.count} AI bot${data.count > 1 ? 's' : ''} joined to play with you!`, '#00CED1');
});

socket.on('bots_removed', () => {
    showNotification(`🤖 AI bots removed - enough human players!`, '#00CED1');
});

socket.on('atomic_bomb_spawned', (data) => {
    showNotification(`💣 ATOMIC BOMB has appeared! Collect it to use devastating power!`, '#FF8C00');
});

socket.on('atomic_bomb_collected', (data) => {
    showNotification(`💣 ${data.player_name} collected the ATOMIC BOMB! Press X to detonate!`, '#FF8C00');
});

socket.on('bomb_warning', (data) => {
    showNotification(`⚠️💣 ${data.player_name} is PREPARING ATOMIC BOMB! ${data.duration}s WARNING!`, '#FF0000');
});

socket.on('atomic_bomb_exploded', (data) => {
    showNotification(`💥💥💥 ${data.player_name} detonated ATOMIC BOMB! ${data.kills} players killed!`, '#FF0000');

    // Start explosion animation
    explosionAnimation = {
        startTime: Date.now(),
        duration: 2000  // 2 seconds
    };
});

socket.on('game_over', (data) => {
    console.log('Game over:', data);
    const gameOverScreen = document.getElementById('game-over-screen');
    const gameOverTitle = document.getElementById('game-over-title');
    const winningTeam = document.getElementById('winning-team');
    const winReason = document.getElementById('win-reason');
    const finalRedKills = document.getElementById('final-red-kills');
    const finalBlueKills = document.getElementById('final-blue-kills');

    // Update game over screen content
    if (data.winner === 'red') {
        gameOverTitle.textContent = '🔴 RED TEAM WINS!';
        gameOverTitle.style.color = '#FF0000';
        winningTeam.textContent = '🏆 RED TEAM VICTORIOUS! 🏆';
        winningTeam.style.color = '#FF0000';
    } else if (data.winner === 'blue') {
        gameOverTitle.textContent = '🔵 BLUE TEAM WINS!';
        gameOverTitle.style.color = '#0000FF';
        winningTeam.textContent = '🏆 BLUE TEAM VICTORIOUS! 🏆';
        winningTeam.style.color = '#0000FF';
    }

    // Show win reason
    if (data.reason === 'kills') {
        winReason.textContent = '✨ Victory by reaching 50 kills! ✨';
    } else if (data.reason === 'base') {
        winReason.textContent = '💥 Victory by destroying enemy base! 💥';
    }

    // Update final scores
    finalRedKills.textContent = gameState.team_red_kills || 0;
    finalBlueKills.textContent = gameState.team_blue_kills || 0;

    // Show game over screen
    gameOverScreen.style.display = 'flex';

    // Show notification
    const winnerName = data.winner === 'red' ? 'RED TEAM' : 'BLUE TEAM';
    showNotification(`🏆 ${winnerName} WINS! 🏆`, data.winner === 'red' ? '#FF0000' : '#0000FF');
});

// Join game
// Welcome-screen tank preview rendering
function renderTankPreviews() {
    const color = (document.querySelector('input[name="tank-color"]:checked') || {}).value || '#32CD32';
    document.querySelectorAll('.tank-preview-canvas').forEach(cv => {
        const pctx = cv.getContext('2d');
        pctx.clearRect(0, 0, cv.width, cv.height);
        // Draw tank centered, pointing right, slightly larger than in-game for readability
        drawTankByClass(pctx, cv.width / 2, cv.height / 2, 0, color, cv.dataset.class, 58);
    });
}

// Re-render previews when color or tank-class selection changes
document.querySelectorAll('input[name="tank-color"]').forEach(el => {
    el.addEventListener('change', renderTankPreviews);
});
document.querySelectorAll('input[name="tank-class"]').forEach(el => {
    el.addEventListener('change', renderTankPreviews);
});
// Initial render
window.addEventListener('load', renderTankPreviews);
// Also render immediately in case 'load' already fired
renderTankPreviews();

joinButton.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Anonymous';
    const selectedMode = document.querySelector('input[name="game-mode"]:checked').value;
    const selectedMap = document.querySelector('input[name="map-type"]:checked').value;
    const selectedColor = (document.querySelector('input[name="tank-color"]:checked') || {}).value || '#32CD32';
    const selectedClass = (document.querySelector('input[name="tank-class"]:checked') || {}).value || 'gun';
    // Tank class determines the ultimate skill (fixed pairing)
    const classToSkill = { gun: 'laser_beam', light: 'speed_demon', armored: 'ghost_mode' };
    const selectedSkill = classToSkill[selectedClass] || 'laser_beam';
    socket.emit('join_game', {
        name: name,
        game_mode: selectedMode,
        map_type: selectedMap,
        color: selectedColor,
        tank_class: selectedClass,
        skill: selectedSkill
    });
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinButton.click();
    }
});

// Keyboard controls
const keys = { w: false, a: false, s: false, d: false };

// Emoji picker state (T to open, ←/→ to select, T again to send, Esc to cancel)
const EMOJI_OPTIONS = ['😁', '😢', '😡', '😲', '🤣', '🙈', '😍', '😫', '🤔', '😏'];
let emojiPickerOpen = false;
let emojiPickerIndex = 0;          // currently highlighted emoji
let emojiLastUsedIndex = 0;        // remembers the last emoji the player sent

function buildEmojiPicker() {
    const list = document.getElementById('emoji-picker-list');
    if (!list || list.childElementCount > 0) return;
    EMOJI_OPTIONS.forEach((em, i) => {
        const cell = document.createElement('div');
        cell.className = 'emoji-picker-item';
        cell.textContent = em;
        cell.dataset.index = i;
        list.appendChild(cell);
    });
}

function refreshEmojiPickerHighlight() {
    const cells = document.querySelectorAll('#emoji-picker-list .emoji-picker-item');
    cells.forEach((el, i) => {
        el.classList.toggle('selected', i === emojiPickerIndex);
    });
}

function openEmojiPicker() {
    buildEmojiPicker();
    emojiPickerOpen = true;
    emojiPickerIndex = emojiLastUsedIndex;  // default to last-used
    const picker = document.getElementById('emoji-picker');
    if (picker) picker.style.display = 'block';
    refreshEmojiPickerHighlight();
}

function closeEmojiPicker() {
    emojiPickerOpen = false;
    const picker = document.getElementById('emoji-picker');
    if (picker) picker.style.display = 'none';
}

function sendSelectedEmoji() {
    const chosen = EMOJI_OPTIONS[emojiPickerIndex];
    emojiLastUsedIndex = emojiPickerIndex;  // remember for next time
    socket.emit('show_emoji', { emoji: chosen });
    closeEmojiPicker();
}

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    // Skip game key handling when typing in an input field
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Emoji picker takes keyboard priority while open
    if (emojiPickerOpen) {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            emojiPickerIndex = (emojiPickerIndex - 1 + EMOJI_OPTIONS.length) % EMOJI_OPTIONS.length;
            refreshEmojiPickerHighlight();
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            emojiPickerIndex = (emojiPickerIndex + 1) % EMOJI_OPTIONS.length;
            refreshEmojiPickerHighlight();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            sendSelectedEmoji();
            return;
        }
        if (e.key === 'Escape' || key === 't') {
            e.preventDefault();
            closeEmojiPicker();
            return;
        }
        // Swallow other game keys while picker is open so the tank doesn't move
        return;
    }

    if (key in keys && keys[key] === false) {
        keys[key] = true;
        socket.emit('key_state', { key: key, pressed: true });
    }

    // Shoot with space
    if (key === ' ' || e.code === 'Space') {
        e.preventDefault();
        socket.emit('shoot');
    }

    // Activate ultimate skill with 'C'
    if (key === 'c') {
        e.preventDefault();
        socket.emit('activate_skill');
    }

    // Activate atomic bomb with 'X'
    if (key === 'x') {
        e.preventDefault();
        socket.emit('activate_atomic_bomb');
    }

    // Open the emoji picker with 'T'
    if (key === 't') {
        e.preventDefault();
        openEmojiPicker();
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();

    if (key in keys && keys[key] === true) {
        keys[key] = false;
        socket.emit('key_state', { key: key, pressed: false });
    }
});

// Mouse controls for aiming and shooting
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();

    // Account for canvas scaling if any
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get mouse position relative to canvas with proper scaling
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;

    // Update crosshair position
    crosshair.style.left = (e.clientX - 10) + 'px';
    crosshair.style.top = (e.clientY - 10) + 'px';

    // Calculate angle to mouse with throttling to improve accuracy
    const myPlayer = gameState.players.find(p => p.id === myPlayerId);
    if (myPlayer && myPlayer.alive) {
        const dx = mouseX - myPlayer.x;
        const dy = mouseY - myPlayer.y;
        const angle = Math.atan2(dy, dx);

        // Only send rotation update if angle changed significantly or enough time passed
        const now = Date.now();
        const angleDiff = Math.abs(angle - currentAngle);

        if (angleDiff > 0.02 || now - lastRotateTime > 50) {
            currentAngle = angle;
            lastRotateTime = now;
            socket.emit('rotate', { angle: angle });
        }
    }
});

canvas.addEventListener('click', () => {
    socket.emit('shoot');
});

// Show crosshair when mouse is over canvas
canvas.addEventListener('mouseenter', () => {
    crosshair.style.display = 'block';
    canvas.style.cursor = 'none';
});

canvas.addEventListener('mouseleave', () => {
    crosshair.style.display = 'none';
    canvas.style.cursor = 'default';
});

// Helper: draw one team base (avoids duplicating ~80 lines for red/blue)
function drawBase(base, borderColor, label) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(base.x + 3, base.y + 3, base.width, base.height);

    const rgb = borderColor === '#FF0000' ? '255, 0, 0' : '0, 0, 255';
    ctx.fillStyle = `rgba(${rgb}, 0.6)`;
    ctx.fillRect(base.x, base.y, base.width, base.height);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(base.x, base.y, base.width, base.height);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏰', base.x + base.width / 2, base.y + base.height / 2);

    const barX = base.x;
    const barY = base.y - 20;
    const barW = base.width;
    const barH = 10;
    const hp = base.health / base.max_health;
    const hpColor = hp < 0.3 ? '#FF0000' : hp < 0.6 ? '#FFAA00' : '#00FF00';

    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hp, barH);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${label}: ${base.health}/${base.max_health}`, base.x + base.width / 2, barY - 10);
}

// Drawing functions
function draw() {
    const now = Date.now();

    // Clear canvas
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw atomic bomb explosion animation
    if (explosionAnimation) {
        const elapsed = now - explosionAnimation.startTime;
        const progress = elapsed / explosionAnimation.duration;

        if (progress < 1) {
            // Expanding shockwave effect
            const maxRadius = Math.max(ARENA_WIDTH, ARENA_HEIGHT) * 1.5;
            const currentRadius = maxRadius * progress;
            const alpha = 1 - progress;

            // Multiple expanding circles
            for (let i = 0; i < 3; i++) {
                const offset = i * 150;
                const radius = currentRadius - offset;

                if (radius > 0) {
                    const gradient = ctx.createRadialGradient(
                        ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 0,
                        ARENA_WIDTH / 2, ARENA_HEIGHT / 2, radius
                    );
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.8})`);
                    gradient.addColorStop(0.3, `rgba(255, 165, 0, ${alpha * 0.6})`);
                    gradient.addColorStop(0.6, `rgba(255, 69, 0, ${alpha * 0.4})`);
                    gradient.addColorStop(1, `rgba(255, 0, 0, 0)`);

                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }

            // Flash effect
            if (progress < 0.2) {
                const flashAlpha = (0.2 - progress) / 0.2;
                ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.9})`;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        } else {
            // Animation complete
            explosionAnimation = null;
        }
    }

    // Draw grid (pre-rendered offscreen canvas — blit in one call)
    ctx.drawImage(gridCanvas, 0, 0);

    // Draw team bases in Duel mode
    if (gameState.game_mode === 'duel') {
        if (gameState.red_base)  drawBase(gameState.red_base,  '#FF0000', 'RED BASE');
        if (gameState.blue_base) drawBase(gameState.blue_base, '#0000FF', 'BLUE BASE');
    }

    // Draw terrain (pre-rendered offscreen canvas — blit in one call)
    if (terrainCanvas) {
        ctx.drawImage(terrainCanvas, 0, 0);
    }

    // Draw huge segmented snake if active (3 cells wide × 13 cells long)
    if (gameState.snake) {
        const snake = gameState.snake;
        const cellSize = 30; // Same as TANK_SIZE
        const widthCells = 3;
        const lengthCells = 13;

        ctx.save();

        // Calculate snake segments (13 cells along length)
        const segments = [];
        for (let i = 0; i < lengthCells; i++) {
            const t = i / (lengthCells - 1);
            const segmentX = snake.x - Math.cos(snake.direction) * snake.length * t;
            const segmentY = snake.y - Math.sin(snake.direction) * snake.length * t;
            segments.push({ x: segmentX, y: segmentY, index: i });
        }

        // Draw each segment (3 cells wide)
        segments.forEach((segment, idx) => {
            const perpAngle = snake.direction + Math.PI / 2;

            // Draw 3 cells wide for each segment
            for (let w = -1; w <= 1; w++) {
                const cellX = segment.x + Math.cos(perpAngle) * w * cellSize;
                const cellY = segment.y + Math.sin(perpAngle) * w * cellSize;

                // Alternate colors for pattern
                const isHead = idx === 0;
                const isDark = (idx + w) % 2 === 0;

                // Draw shadow
                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                ctx.fillRect(
                    cellX - cellSize / 2 + 3,
                    cellY - cellSize / 2 + 3,
                    cellSize,
                    cellSize
                );

                // Draw cell body
                if (isHead) {
                    ctx.fillStyle = '#FF0000'; // Bright red head
                } else {
                    ctx.fillStyle = isDark ? '#8B0000' : '#A52A2A'; // Dark red pattern
                }
                ctx.fillRect(
                    cellX - cellSize / 2,
                    cellY - cellSize / 2,
                    cellSize,
                    cellSize
                );

                // Draw cell border
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeRect(
                    cellX - cellSize / 2,
                    cellY - cellSize / 2,
                    cellSize,
                    cellSize
                );

                // Draw scales pattern
                if (!isHead) {
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(cellX, cellY, cellSize / 3, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            // Draw eyes on head (first segment, middle cell only)
            if (idx === 0) {
                const eyeSize = 6;
                const eyeSpacing = 10;
                const eyeForward = 8;

                // Left eye
                const leftEyeX = segment.x + Math.cos(snake.direction) * eyeForward - Math.cos(perpAngle) * eyeSpacing;
                const leftEyeY = segment.y + Math.sin(snake.direction) * eyeForward - Math.sin(perpAngle) * eyeSpacing;

                ctx.fillStyle = '#FFFF00';
                ctx.beginPath();
                ctx.arc(leftEyeX, leftEyeY, eyeSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#000000';
                ctx.beginPath();
                ctx.arc(leftEyeX, leftEyeY, eyeSize / 2, 0, Math.PI * 2);
                ctx.fill();

                // Right eye
                const rightEyeX = segment.x + Math.cos(snake.direction) * eyeForward + Math.cos(perpAngle) * eyeSpacing;
                const rightEyeY = segment.y + Math.sin(snake.direction) * eyeForward + Math.sin(perpAngle) * eyeSpacing;

                ctx.fillStyle = '#FFFF00';
                ctx.beginPath();
                ctx.arc(rightEyeX, rightEyeY, eyeSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#000000';
                ctx.beginPath();
                ctx.arc(rightEyeX, rightEyeY, eyeSize / 2, 0, Math.PI * 2);
                ctx.fill();

                // Forked tongue
                const tongueLen = 15;
                const tongueFork = 8;
                const tongueX = segment.x + Math.cos(snake.direction) * (cellSize / 2);
                const tongueY = segment.y + Math.sin(snake.direction) * (cellSize / 2);

                ctx.strokeStyle = '#FF0000';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';

                // Main tongue
                ctx.beginPath();
                ctx.moveTo(tongueX, tongueY);
                const tongueTipX = tongueX + Math.cos(snake.direction) * tongueLen;
                const tongueTipY = tongueY + Math.sin(snake.direction) * tongueLen;
                ctx.lineTo(tongueTipX, tongueTipY);
                ctx.stroke();

                // Fork left
                ctx.beginPath();
                ctx.moveTo(tongueTipX, tongueTipY);
                ctx.lineTo(
                    tongueTipX + Math.cos(snake.direction - 0.4) * tongueFork,
                    tongueTipY + Math.sin(snake.direction - 0.4) * tongueFork
                );
                ctx.stroke();

                // Fork right
                ctx.beginPath();
                ctx.moveTo(tongueTipX, tongueTipY);
                ctx.lineTo(
                    tongueTipX + Math.cos(snake.direction + 0.4) * tongueFork,
                    tongueTipY + Math.sin(snake.direction + 0.4) * tongueFork
                );
                ctx.stroke();
            }
        });

        // Draw health bar above snake
        if (snake.health !== undefined && snake.max_health !== undefined) {
            const barWidth = 150;
            const barHeight = 12;
            const barX = snake.x - barWidth / 2;
            const barY = snake.y - snake.length / 2 - 30;

            // Background
            ctx.fillStyle = '#333333';
            ctx.fillRect(barX, barY, barWidth, barHeight);

            // Health
            const healthPercent = snake.health / snake.max_health;
            let healthColor = '#00FF00';
            if (healthPercent < 0.3) healthColor = '#FF0000';
            else if (healthPercent < 0.6) healthColor = '#FFAA00';

            ctx.fillStyle = healthColor;
            ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

            // Border
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, barY, barWidth, barHeight);

            // HP Text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${snake.health}/${snake.max_health}`, snake.x, barY + barHeight / 2 + 3);

            // "HUGE SNAKE" label
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 12px Arial';
            ctx.fillText('HUGE SNAKE', snake.x, barY - 5);
        }

        ctx.restore();
    }

    // Draw supply drops (can be multiple)
    if (gameState.supply_drops && gameState.supply_drops.length > 0) {
        gameState.supply_drops.forEach(drop => {
            // Pulsing animation
            const pulse = Math.sin(now / 200) * 0.2 + 1;
            const size = drop.size * pulse;

            // Draw outer glow
            const gradient = ctx.createRadialGradient(drop.x, drop.y, 0, drop.x, drop.y, size);
            let glowColor1, glowColor2, boxColor, icon;

            if (drop.type === 'fast_fire') {
                glowColor1 = 'rgba(255, 165, 0, 0.8)';
                glowColor2 = 'rgba(255, 165, 0, 0)';
                boxColor = '#FFA500';
                icon = '⚡';
            } else if (drop.type === 'fan_shot') {
                glowColor1 = 'rgba(138, 43, 226, 0.8)';
                glowColor2 = 'rgba(138, 43, 226, 0)';
                boxColor = '#8A2BE2';
                icon = '✦';
            } else if (drop.type === 'speed_boost') {
                glowColor1 = 'rgba(0, 255, 255, 0.8)';
                glowColor2 = 'rgba(0, 255, 255, 0)';
                boxColor = '#00FFFF';
                icon = '➤';
            } else { // super_powerup
                glowColor1 = 'rgba(255, 215, 0, 0.9)';
                glowColor2 = 'rgba(255, 215, 0, 0)';
                boxColor = '#FFD700';
                icon = '★';
            }

            gradient.addColorStop(0, glowColor1);
            gradient.addColorStop(1, glowColor2);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(drop.x, drop.y, size * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // Draw main box
            ctx.fillStyle = boxColor;
            ctx.fillRect(drop.x - size/2, drop.y - size/2, size, size);

            // Draw border (thicker for super)
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = drop.type === 'super_powerup' ? 4 : 3;
            ctx.strokeRect(drop.x - size/2, drop.y - size/2, size, size);

            // Draw icon
            ctx.fillStyle = drop.type === 'super_powerup' ? '#000000' : '#FFFFFF';
            ctx.font = drop.type === 'super_powerup' ? 'bold 20px Arial' : 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, drop.x, drop.y);

            // Add rotating effect for super power-up
            if (drop.type === 'super_powerup') {
                ctx.save();
                ctx.translate(drop.x, drop.y);
                ctx.rotate(now / 500);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 2;
                ctx.strokeRect(-size/2 - 5, -size/2 - 5, size + 10, size + 10);
                ctx.restore();
            }
        });
    }

    // Draw shield drop if active
    if (gameState.shield_drop) {
        const drop = gameState.shield_drop;

        // Pulsing animation
        const pulse = Math.sin(now / 200) * 0.2 + 1;
        const size = drop.size * pulse;

        // Draw outer glow (cyan/blue)
        const gradient = ctx.createRadialGradient(drop.x, drop.y, 0, drop.x, drop.y, size);
        gradient.addColorStop(0, 'rgba(0, 191, 255, 0.9)');
        gradient.addColorStop(1, 'rgba(0, 191, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, size * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw shield icon background
        ctx.fillStyle = '#00BFFF';
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw shield border
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, size / 2, 0, Math.PI * 2);
        ctx.stroke();

        // Draw shield icon
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🛡', drop.x, drop.y);

        // Add rotating hexagon effect
        ctx.save();
        ctx.translate(drop.x, drop.y);
        ctx.rotate(now / 500);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;

        // Draw hexagon
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = Math.cos(angle) * (size / 2 + 8);
            const y = Math.sin(angle) * (size / 2 + 8);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    // Draw atomic bomb if active
    if (gameState.atomic_bomb) {
        const bomb = gameState.atomic_bomb;

        // Intense pulsing animation
        const pulse = Math.sin(now / 150) * 0.3 + 1;
        const size = bomb.size * pulse;

        // Draw danger glow (orange/red)
        const gradient = ctx.createRadialGradient(bomb.x, bomb.y, 0, bomb.x, bomb.y, size * 2);
        gradient.addColorStop(0, 'rgba(255, 140, 0, 1)');
        gradient.addColorStop(0.5, 'rgba(255, 69, 0, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(bomb.x, bomb.y, size * 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw bomb body
        ctx.fillStyle = '#2C2C2C';
        ctx.beginPath();
        ctx.arc(bomb.x, bomb.y, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw bomb border (flashing)
        const flashAlpha = Math.sin(now / 100) * 0.5 + 0.5;
        ctx.strokeStyle = `rgba(255, 0, 0, ${flashAlpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(bomb.x, bomb.y, size / 2, 0, Math.PI * 2);
        ctx.stroke();

        // Draw atomic symbol
        ctx.fillStyle = '#FF0000';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☢️', bomb.x, bomb.y);

        // Draw warning text
        ctx.fillStyle = `rgba(255, 140, 0, ${flashAlpha})`;
        ctx.font = 'bold 12px Arial';
        ctx.fillText('ATOMIC BOMB', bomb.x, bomb.y - size / 2 - 15);

        // Add rotating warning triangles
        ctx.save();
        ctx.translate(bomb.x, bomb.y);
        ctx.rotate(now / 400);

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const x = Math.cos(angle) * (size / 2 + 15);
            const y = Math.sin(angle) * (size / 2 + 15);

            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.beginPath();
            ctx.moveTo(x, y - 8);
            ctx.lineTo(x - 6, y + 4);
            ctx.lineTo(x + 6, y + 4);
            ctx.closePath();
            ctx.fill();

            // Warning symbol
            ctx.fillStyle = '#FFFF00';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('!', x, y);
        }
        ctx.restore();
    }

    // Draw bullets
    gameState.bullets.forEach(bullet => {
        // Different visuals for ricochet bullets
        const hasRicochet = bullet.ricochets_left > 0;

        if (hasRicochet) {
            // Ricochet bullets have a cyan/blue glow
            const glowColor = bullet.ricochets_left >= 2 ? '#00FFFF' : '#00AAFF';
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 15;
            ctx.fillStyle = glowColor;
        } else {
            // Regular bullets are yellow
            ctx.fillStyle = '#FFFF00';
            ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 6, 0, Math.PI * 2);
        ctx.fill();

        // Draw bullet trail
        if (hasRicochet) {
            ctx.strokeStyle = `rgba(0, ${bullet.ricochets_left >= 2 ? 255 : 170}, 255, 0.4)`;
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
        }
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(bullet.x - bullet.vx * 2, bullet.y - bullet.vy * 2);
        ctx.stroke();

        // Reset shadow
        ctx.shadowBlur = 0;
    });

    // Draw tanks
    gameState.players.forEach(player => {
        // Skip drawing if tank is hidden in bush (except for own tank)
        if (player.hidden && player.id !== myPlayerId) {
            return; // Don't draw hidden enemy tanks
        }

        if (!player.alive) {
            ctx.globalAlpha = 0.3;
        } else if (player.hidden && player.id === myPlayerId) {
            // Show own tank semi-transparent when hidden
            ctx.globalAlpha = 0.7;
        }

        // Add pulsing glow effect for invincible tanks
        if (player.invincible && player.alive) {
            const pulseAlpha = Math.sin(now / 200) * 0.3 + 0.5;
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 25 * pulseAlpha;
        }

        // Show laser beam preparation warning
        if (player.laser_preparing && player.alive) {
            // Red pulsing warning effect
            const pulseAlpha = Math.sin(now / 150) * 0.4 + 0.6;
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = 50 * pulseAlpha;

            // Draw warning rings around tank
            ctx.strokeStyle = 'rgba(255, 0, 0, ' + pulseAlpha + ')';
            ctx.lineWidth = 4;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(player.x, player.y, TANK_SIZE + 10 + i * 15, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw warning indicator above tank
            ctx.fillStyle = 'rgba(255, 0, 0, ' + pulseAlpha + ')';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('⚠️', player.x, player.y - TANK_SIZE - 20);

            // Show countdown
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 14px Arial';
            const timeLeft = Math.ceil(player.laser_preparation_time_left);
            ctx.fillText(`CHARGING ${timeLeft}s`, player.x, player.y - TANK_SIZE - 40);
        }

        // Show post-firing cooldown indicator
        if (player.laser_cooling_down && player.alive) {
            // Blue frozen effect
            const pulseAlpha = Math.sin(now / 100) * 0.3 + 0.5;
            ctx.shadowColor = '#00BFFF';
            ctx.shadowBlur = 30 * pulseAlpha;

            // Ice crystals around tank
            ctx.strokeStyle = 'rgba(0, 191, 255, ' + pulseAlpha + ')';
            ctx.lineWidth = 3;
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + now / 300;
                const x1 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 5);
                const y1 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 5);
                const x2 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 12);
                const y2 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 12);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            // Frozen indicator
            ctx.fillStyle = 'rgba(0, 191, 255, ' + pulseAlpha + ')';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('❄️ FROZEN', player.x, player.y - TANK_SIZE - 30);
        }

        // Show atomic bomb preparation warning
        if (player.bomb_preparing && player.alive) {
            // MASSIVE orange/red pulsing warning effect
            const pulseAlpha = Math.sin(now / 100) * 0.5 + 0.5;
            ctx.shadowColor = '#FF4500';
            ctx.shadowBlur = 80 * pulseAlpha;

            // Draw HUGE warning rings around tank
            ctx.strokeStyle = 'rgba(255, 69, 0, ' + pulseAlpha + ')';
            ctx.lineWidth = 6;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.arc(player.x, player.y, TANK_SIZE + 20 + i * 20, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw radiation symbol
            ctx.fillStyle = 'rgba(255, 69, 0, ' + pulseAlpha + ')';
            ctx.font = 'bold 30px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('☢️', player.x, player.y - TANK_SIZE - 30);

            // Show HUGE countdown
            ctx.fillStyle = '#FFFF00';
            ctx.font = 'bold 20px Arial';
            const timeLeft = Math.ceil(player.bomb_preparation_time_left);
            ctx.fillText(`BOMB ARMING ${timeLeft}s`, player.x, player.y - TANK_SIZE - 60);

            // Danger text
            ctx.fillStyle = '#FF0000';
            ctx.font = 'bold 16px Arial';
            ctx.fillText('⚠️ DANGER ⚠️', player.x, player.y - TANK_SIZE - 85);
        }

        // Show post-detonation freeze indicator
        if (player.bomb_freezing && player.alive) {
            // Heavy frozen effect after explosion
            const pulseAlpha = Math.sin(now / 80) * 0.4 + 0.6;
            ctx.shadowColor = '#4169E1';
            ctx.shadowBlur = 40 * pulseAlpha;

            // Thick ice crystals
            ctx.strokeStyle = 'rgba(65, 105, 225, ' + pulseAlpha + ')';
            ctx.lineWidth = 4;
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2 + now / 200;
                const x1 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 8);
                const y1 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 8);
                const x2 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 18);
                const y2 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 18);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            // Heavy freeze indicator
            ctx.fillStyle = 'rgba(65, 105, 225, ' + pulseAlpha + ')';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('❄️ EXHAUSTED ❄️', player.x, player.y - TANK_SIZE - 35);
        }

        // "Hunt the Captain" targeting effect (triggered every 30s server-side)
        if (player.captain_targeted && player.alive) {
            ctx.save();
            const t = now / 200;
            const pulse = Math.sin(t) * 0.35 + 0.65;

            // Outer pulsing glow
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = 40 * pulse;

            // Rotating red reticle rings
            const baseRadius = TANK_SIZE + 10;
            for (let ring = 0; ring < 3; ring++) {
                const r = baseRadius + ring * 6 + Math.sin(t + ring) * 3;
                ctx.strokeStyle = `rgba(255, 40, 40, ${pulse * (0.9 - ring * 0.2)})`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Crosshair brackets (4 corner arcs) that rotate slowly
            const rot = t * 0.5;
            ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
            ctx.lineWidth = 4;
            const bracketRadius = baseRadius + 14;
            for (let i = 0; i < 4; i++) {
                const start = rot + i * (Math.PI / 2) - 0.35;
                const end = rot + i * (Math.PI / 2) + 0.35;
                ctx.beginPath();
                ctx.arc(player.x, player.y, bracketRadius, start, end);
                ctx.stroke();
            }

            // Crosshair lines through the tank (N/S/E/W tick marks)
            ctx.strokeStyle = `rgba(255, 60, 60, ${pulse * 0.9})`;
            ctx.lineWidth = 2;
            const tickInner = baseRadius - 4;
            const tickOuter = baseRadius + 18;
            for (let i = 0; i < 4; i++) {
                const a = rot + i * (Math.PI / 2);
                ctx.beginPath();
                ctx.moveTo(player.x + Math.cos(a) * tickInner, player.y + Math.sin(a) * tickInner);
                ctx.lineTo(player.x + Math.cos(a) * tickOuter, player.y + Math.sin(a) * tickOuter);
                ctx.stroke();
            }

            // Bounty label above the tank
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#FF3030';
            ctx.font = 'bold 13px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🎯 +1000 BOUNTY 🎯', player.x, player.y - TANK_SIZE - 40);
            ctx.restore();
        }

        // Add visual effects for active skills
        if (player.skill_active && player.alive) {
            if (player.skill === 'speed_demon') {
                // Speed Demon: Lightning aura
                const pulseAlpha = Math.sin(now / 100) * 0.4 + 0.6;
                ctx.shadowColor = '#FFFF00';
                ctx.shadowBlur = 35 * pulseAlpha;

                // Draw lightning bolts around tank
                ctx.strokeStyle = 'rgba(255, 255, 0, ' + pulseAlpha + ')';
                ctx.lineWidth = 2;
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2 + now / 500;
                    const x1 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 5);
                    const y1 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 5);
                    const x2 = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 15);
                    const y2 = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 15);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }
            } else if (player.skill === 'laser_beam') {
                // Laser Beam: Draw red laser from tank
                const laserRange = 1500;
                const gradient = ctx.createLinearGradient(
                    player.x, player.y,
                    player.x + Math.cos(player.angle) * laserRange,
                    player.y + Math.sin(player.angle) * laserRange
                );
                gradient.addColorStop(0, 'rgba(255, 0, 0, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');

                ctx.strokeStyle = gradient;
                ctx.lineWidth = 8;
                ctx.shadowColor = '#FF0000';
                ctx.shadowBlur = 20;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(
                    player.x + Math.cos(player.angle) * laserRange,
                    player.y + Math.sin(player.angle) * laserRange
                );
                ctx.stroke();

                // Draw laser core (brighter)
                ctx.strokeStyle = 'rgba(255, 100, 100, 0.9)';
                ctx.lineWidth = 4;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(
                    player.x + Math.cos(player.angle) * laserRange,
                    player.y + Math.sin(player.angle) * laserRange
                );
                ctx.stroke();
            } else if (player.skill === 'ghost_mode') {
                // Ghost Mode: Ghostly transparent effect
                const pulseAlpha = Math.sin(now / 150) * 0.3 + 0.5;
                ctx.shadowColor = '#9370DB';
                ctx.shadowBlur = 30 * pulseAlpha;
                ctx.globalAlpha = 0.6;
            }
        }

        // Draw the tank using its class-specific renderer (body, turret, barrel)
        drawTankByClass(ctx, player.x, player.y, player.angle || 0, player.color, player.tank_class, TANK_SIZE);

        // Reset shadow effect
        ctx.shadowBlur = 0;

        // Draw health bar above tank
        const barWidth = TANK_SIZE + 10;
        const barHeight = 5;
        const barX = player.x - barWidth / 2;
        const barY = player.y - TANK_SIZE / 2 - 15;

        // Background
        ctx.fillStyle = '#333333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Health
        const healthPercent = player.health / player.max_health;
        let healthColor = '#00FF00';
        if (healthPercent < 0.3) healthColor = '#FF0000';
        else if (healthPercent < 0.6) healthColor = '#FFAA00';

        ctx.fillStyle = healthColor;
        ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

        // Border
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // Draw player name above health bar with team indicator
        ctx.fillStyle = player.color;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        let nameDisplay = player.is_bot ? `${player.name} 🤖` : player.name;

        // Add atomic bomb indicator
        if (player.has_atomic_bomb) {
            nameDisplay = `💣 ${nameDisplay} 💣`;
        }

        // Add Captain indicator
        let captainOffset = 0;
        if (player.is_captain) {
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 14px Arial';
            ctx.fillText('👑 CAPTAIN 👑', player.x, barY - 18);
            captainOffset = 13;  // Add offset for name to appear below captain text
        }

        // Add team indicator in Duel mode
        let topOffset = captainOffset;
        if (gameState.game_mode === 'duel' && player.team) {
            const teamLabel = player.team === 'red' ? '[RED]' : '[BLUE]';
            const teamColor = player.team === 'red' ? '#FF0000' : '#0000FF';
            ctx.fillStyle = teamColor;
            ctx.fillText(teamLabel, player.x, barY - 18 - captainOffset);
            topOffset = captainOffset + 13;  // team label takes extra vertical space
            ctx.fillStyle = player.color;
            ctx.font = 'bold 12px Arial';
            ctx.fillText(nameDisplay, player.x, barY - 5);
        } else {
            ctx.fillStyle = player.color;
            ctx.font = 'bold 12px Arial';
            ctx.fillText(nameDisplay, player.x, barY - 5);
        }

        // Draw emoji above everything (captain / team label / name)
        if (player.emoji) {
            ctx.font = '22px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(player.emoji, player.x, barY - 22 - topOffset);
        }

        // Highlight own tank with square border
        if (player.id === myPlayerId) {
            // Show different color when hidden
            ctx.strokeStyle = player.hidden ? '#00FF00' : '#FFD700';
            ctx.lineWidth = 3;
            ctx.strokeRect(
                player.x - TANK_SIZE / 2 - 3,
                player.y - TANK_SIZE / 2 - 3,
                TANK_SIZE + 6,
                TANK_SIZE + 6
            );

            // Show "HIDDEN" indicator when in bush
            if (player.hidden) {
                ctx.fillStyle = '#00FF00';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('HIDDEN', player.x, player.y - TANK_SIZE / 2 - 30);
            }
        } else if (gameState.game_mode === 'duel' && player.team) {
            // Show team border for other players in Duel mode
            const teamBorderColor = player.team === 'red' ? '#FF0000' : '#0000FF';
            ctx.strokeStyle = teamBorderColor;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                player.x - TANK_SIZE / 2 - 2,
                player.y - TANK_SIZE / 2 - 2,
                TANK_SIZE + 4,
                TANK_SIZE + 4
            );
        }

        // Draw power-up indicators for all active power-ups (stacking)
        if (player.powerups && player.powerups.length > 0) {
            const offsetY = player.id === myPlayerId && player.hidden ? -45 : -35;
            const iconSpacing = 26; // Space between icons

            // Draw each active power-up icon
            player.powerups.forEach((powerup, index) => {
                const xOffset = (index - (player.powerups.length - 1) / 2) * iconSpacing;

                // Power-up icon background and icon
                let bgColor, powerupIcon;
                if (powerup === 'fast_fire') {
                    bgColor = 'rgba(255, 165, 0, 0.8)';
                    powerupIcon = '⚡';
                } else if (powerup === 'fan_shot') {
                    bgColor = 'rgba(138, 43, 226, 0.8)';
                    powerupIcon = '✦';
                } else if (powerup === 'speed_boost') {
                    bgColor = 'rgba(0, 255, 255, 0.8)';
                    powerupIcon = '➤';
                } else if (powerup === 'invincibility_shield') {
                    bgColor = 'rgba(0, 191, 255, 0.8)';
                    powerupIcon = '🛡';
                }

                ctx.fillStyle = bgColor;
                ctx.fillRect(player.x + xOffset - 12, player.y + offsetY, 24, 16);

                // Power-up icon
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(powerupIcon, player.x + xOffset, player.y + offsetY + 8);
            });

            // Time remaining (shown once below all icons)
            if (player.powerup_time_left > 0) {
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 8px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(
                    Math.ceil(player.powerup_time_left) + 's',
                    player.x,
                    player.y + offsetY + 20
                );
            }
        }

        ctx.globalAlpha = 1.0;
    });

    drawParticles();
    // Muzzle flashes on top of everything
    drawMuzzleFlashes(now);
}

// Update UI elements
function updateUI() {
    // Update player count
    const aliveCount = gameState.players.filter(p => p.alive).length;
    playersCount.textContent = `${gameState.players.length} player${gameState.players.length !== 1 ? 's' : ''} (${aliveCount} alive)`;

    // Find my player
    const myPlayer = gameState.players.find(p => p.id === myPlayerId);

    if (myPlayer) {
        // Update my stats
        myScore.textContent = myPlayer.score;
        myKills.textContent = myPlayer.kills;
        myDeaths.textContent = myPlayer.deaths;
        myStatus.textContent = myPlayer.alive ? 'Alive' : 'Dead';
        myStatus.className = 'stat-value ' + (myPlayer.alive ? 'alive' : 'dead');

        // Update health bar
        const healthPercent = (myPlayer.health / myPlayer.max_health) * 100;
        myHealthBar.style.width = healthPercent + '%';
        myHealthText.textContent = `${myPlayer.health}/${myPlayer.max_health}`;

        if (healthPercent < 30) {
            myHealthBar.style.backgroundColor = '#FF0000';
        } else if (healthPercent < 60) {
            myHealthBar.style.backgroundColor = '#FFAA00';
        } else {
            myHealthBar.style.backgroundColor = '#00FF00';
        }

        // Update skill display
        if (myPlayer.skill) {
            const skillNames = {
                'speed_demon': 'Speed Demon',
                'laser_beam': 'Laser Beam',
                'ghost_mode': 'Ghost Mode'
            };
            const skillIcons = {
                'speed_demon': '⚡',
                'laser_beam': '🔴',
                'ghost_mode': '👻'
            };

            skillName.textContent = skillNames[myPlayer.skill] || myPlayer.skill;
            skillIcon.textContent = skillIcons[myPlayer.skill] || '?';

            // Update skill progress bar
            if (myPlayer.skill_active) {
                // Skill is currently active
                const timeLeft = Math.ceil(myPlayer.skill_time_left);
                skillProgressFill.className = 'active';
                skillProgressFill.style.width = '100%';
                skillProgressText.textContent = `ACTIVE! ${timeLeft}s`;
            } else if (myPlayer.skill_cooldown > 0) {
                // Skill is on cooldown
                const cooldownLeft = Math.ceil(myPlayer.skill_cooldown);
                const cooldownPercent = (cooldownLeft / 30) * 100; // 30s total cooldown
                skillProgressFill.className = 'cooldown';
                skillProgressFill.style.width = cooldownPercent + '%';
                skillProgressText.textContent = `Cooldown: ${cooldownLeft}s`;
            } else {
                // Skill is ready
                skillProgressFill.className = 'ready';
                skillProgressFill.style.width = '100%';
                skillProgressText.textContent = 'READY! Press C';
            }
        }

        // Update atomic bomb panel visibility and status
        if (myPlayer.has_atomic_bomb || myPlayer.bomb_preparing || myPlayer.bomb_freezing) {
            atomicBombPanel.style.display = 'block';

            if (myPlayer.bomb_preparing) {
                // Show countdown during preparation
                const timeLeft = Math.ceil(myPlayer.bomb_preparation_time_left);
                bombStatusText.textContent = `ARMING: ${timeLeft}s`;
                bombActionText.textContent = '⚠️ STAND CLEAR! ⚠️';
                bombActionText.style.animation = 'blink 0.2s infinite';
            } else if (myPlayer.bomb_freezing) {
                // Show exhausted state
                bombStatusText.textContent = 'EXHAUSTED';
                bombActionText.textContent = '❄️ Recovering... ❄️';
                bombActionText.style.animation = 'none';
            } else {
                // Ready to activate
                bombStatusText.textContent = 'READY TO DETONATE';
                bombActionText.textContent = "Press 'X' to activate!";
                bombActionText.style.animation = 'blink 0.5s infinite';
            }
        } else {
            atomicBombPanel.style.display = 'none';
        }

        // Show death screen with respawn timer
        if (!myPlayer.alive) {
            if (deathScreen.style.display === 'none') {
                finalScore.textContent = `Score: ${myPlayer.score}`;
                finalKD.textContent = `K/D: ${myPlayer.kills}/${myPlayer.deaths}`;
                killedBy.textContent = lastKilledBy ? `Killed by: ${lastKilledBy}` : 'Destroyed!';
                deathScreen.style.display = 'flex';
            }

            // Update respawn button with timer
            if (myPlayer.respawn_timer > 0) {
                respawnButton.textContent = `Respawning in ${myPlayer.respawn_timer}s...`;
                respawnButton.disabled = true;
            } else {
                respawnButton.textContent = 'Respawn';
                respawnButton.disabled = false;
            }
        }
    }

    // Update leaderboard
    if (gameState.game_mode === 'duel') {
        // Duel mode: Show team scores and grouped players
        let leaderboardHTML = '';

        // Team scores
        leaderboardHTML += `
            <div style="margin-bottom: 10px; padding: 8px; background: rgba(255, 0, 0, 0.2); border-left: 4px solid #FF0000;">
                <strong style="color: #FF0000;">RED TEAM</strong> - <strong>${gameState.team_red_kills || 0}</strong> kills
            </div>
            <div style="margin-bottom: 15px; padding: 8px; background: rgba(0, 0, 255, 0.2); border-left: 4px solid #0000FF;">
                <strong style="color: #0000FF;">BLUE TEAM</strong> - <strong>${gameState.team_blue_kills || 0}</strong> kills
            </div>
        `;

        // Separate players by team
        const redPlayers = gameState.players.filter(p => p.team === 'red').sort((a, b) => b.score - a.score);
        const bluePlayers = gameState.players.filter(p => p.team === 'blue').sort((a, b) => b.score - a.score);

        // Show Red Team players
        if (redPlayers.length > 0) {
            leaderboardHTML += '<div style="color: #FF0000; font-weight: bold; margin-top: 10px;">🔴 Red Team:</div>';
            redPlayers.forEach((player, index) => {
                const isMe = player.id === myPlayerId;
                const botIndicator = player.is_bot ? ' 🤖' : '';
                leaderboardHTML += `
                    <div class="leaderboard-entry ${isMe ? 'my-entry' : ''}" style="border-left: 3px solid #FF0000;">
                        <span class="player-name" style="color: ${player.color}">${player.name}${botIndicator}</span>
                        <span class="player-score">${player.kills} kills</span>
                    </div>
                `;
            });
        }

        // Show Blue Team players
        if (bluePlayers.length > 0) {
            leaderboardHTML += '<div style="color: #0000FF; font-weight: bold; margin-top: 10px;">🔵 Blue Team:</div>';
            bluePlayers.forEach((player, index) => {
                const isMe = player.id === myPlayerId;
                const botIndicator = player.is_bot ? ' 🤖' : '';
                leaderboardHTML += `
                    <div class="leaderboard-entry ${isMe ? 'my-entry' : ''}" style="border-left: 3px solid #0000FF;">
                        <span class="player-name" style="color: ${player.color}">${player.name}${botIndicator}</span>
                        <span class="player-score">${player.kills} kills</span>
                    </div>
                `;
            });
        }

        leaderboard.innerHTML = leaderboardHTML;
    } else {
        // FFA mode: Regular leaderboard
        const sortedPlayers = [...gameState.players]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        if (sortedPlayers.length === 0) {
            leaderboard.innerHTML = '<p class="no-players">No players yet</p>';
        } else {
            leaderboard.innerHTML = sortedPlayers.map((player, index) => {
                const isMe = player.id === myPlayerId;
                const statusIcon = player.alive ? '' : '';
                const botIndicator = player.is_bot ? ' 🤖' : '';
                return `
                    <div class="leaderboard-entry ${isMe ? 'my-entry' : ''}">
                        <span class="rank">#${index + 1}</span>
                        <span class="player-name" style="color: ${player.color}">${player.name}${botIndicator}</span>
                        <span class="player-score">${player.score} ${statusIcon}</span>
                    </div>
                `;
            }).join('');
        }
    }
}

// Show notifications
function showNotification(message, color = '#32CD32') {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.borderLeftColor = color;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Game over screen button
const gameOverOkButton = document.getElementById('game-over-ok');
gameOverOkButton.addEventListener('click', () => {
    document.getElementById('game-over-screen').style.display = 'none';
});

// RAF-based animation loop — decouples rendering from the server tick rate (30/s).
// Runs at the browser's refresh rate (~60fps), giving smooth particles, muzzle
// flashes, and pulsing effects even between server packets.
let _rafLastTs = 0;
function rafLoop(ts) {
    const dt = _rafLastTs ? ts - _rafLastTs : 1000 / 30;
    _rafLastTs = ts;
    updateParticles(dt);
    if (myPlayerId !== null) {
        draw();
    }
    requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);

// Focus name input on load
window.addEventListener('load', () => {
    playerNameInput.focus();
});
