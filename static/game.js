// Multiplayer Tank Battle - Client Side
const socket = io();

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game constants
const ARENA_WIDTH = 1440;
const ARENA_HEIGHT = 840;  // Reduced to fit with header/footer
const TANK_SIZE = 30;

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

// Cache for bush foliage patterns (optimization - avoid regenerating random patterns every frame)
let bushFoliageCache = new Map();

// Atomic bomb explosion animation
let explosionAnimation = null; // {startTime, duration}

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
    // Store terrain once (optimization - terrain doesn't change during game)
    if (data.terrain) {
        gameState.terrain = data.terrain;
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
    // Preserve terrain if not in update (optimization - terrain sent once)
    const preservedTerrain = gameState.terrain;
    gameState = data;
    if (!gameState.terrain && preservedTerrain) {
        gameState.terrain = preservedTerrain;
    }
    updateUI();
    draw();
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
    // Could play sound effect here
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
joinButton.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Anonymous';
    const selectedMode = document.querySelector('input[name="game-mode"]:checked').value;
    const selectedMap = document.querySelector('input[name="map-type"]:checked').value;
    const selectedColor = document.getElementById('tank-color').value;
    const selectedIcon = document.querySelector('input[name="tank-icon"]:checked').value;
    const selectedSkill = document.querySelector('input[name="skill"]:checked').value;
    socket.emit('join_game', {
        name: name,
        game_mode: selectedMode,
        map_type: selectedMap,
        color: selectedColor,
        icon: selectedIcon,
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

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

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

// Drawing functions
function draw() {
    // Clear canvas
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw atomic bomb explosion animation
    if (explosionAnimation) {
        const elapsed = Date.now() - explosionAnimation.startTime;
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

    // Draw grid
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x <= ARENA_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ARENA_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= ARENA_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ARENA_WIDTH, y);
        ctx.stroke();
    }

    // Draw team bases in Duel mode
    if (gameState.game_mode === 'duel') {
        // Draw Red Base
        if (gameState.red_base) {
            const base = gameState.red_base;
            // Base shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(base.x + 3, base.y + 3, base.width, base.height);

            // Base body
            ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
            ctx.fillRect(base.x, base.y, base.width, base.height);

            // Base border
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 4;
            ctx.strokeRect(base.x, base.y, base.width, base.height);

            // Base core symbol
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🏰', base.x + base.width / 2, base.y + base.height / 2);

            // Health bar above base
            const barWidth = base.width;
            const barHeight = 10;
            const barX = base.x;
            const barY = base.y - 20;

            // Background
            ctx.fillStyle = '#333333';
            ctx.fillRect(barX, barY, barWidth, barHeight);

            // Health
            const healthPercent = base.health / base.max_health;
            let healthColor = '#00FF00';
            if (healthPercent < 0.3) healthColor = '#FF0000';
            else if (healthPercent < 0.6) healthColor = '#FFAA00';

            ctx.fillStyle = healthColor;
            ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

            // Border
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, barY, barWidth, barHeight);

            // HP Text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`RED BASE: ${base.health}/${base.max_health}`, base.x + base.width / 2, barY - 10);
        }

        // Draw Blue Base
        if (gameState.blue_base) {
            const base = gameState.blue_base;
            // Base shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(base.x + 3, base.y + 3, base.width, base.height);

            // Base body
            ctx.fillStyle = 'rgba(0, 0, 255, 0.6)';
            ctx.fillRect(base.x, base.y, base.width, base.height);

            // Base border
            ctx.strokeStyle = '#0000FF';
            ctx.lineWidth = 4;
            ctx.strokeRect(base.x, base.y, base.width, base.height);

            // Base core symbol
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🏰', base.x + base.width / 2, base.y + base.height / 2);

            // Health bar above base
            const barWidth = base.width;
            const barHeight = 10;
            const barX = base.x;
            const barY = base.y - 20;

            // Background
            ctx.fillStyle = '#333333';
            ctx.fillRect(barX, barY, barWidth, barHeight);

            // Health
            const healthPercent = base.health / base.max_health;
            let healthColor = '#00FF00';
            if (healthPercent < 0.3) healthColor = '#FF0000';
            else if (healthPercent < 0.6) healthColor = '#FFAA00';

            ctx.fillStyle = healthColor;
            ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

            // Border
            ctx.strokeStyle = '#0000FF';
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, barY, barWidth, barHeight);

            // HP Text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`BLUE BASE: ${base.health}/${base.max_health}`, base.x + base.width / 2, barY - 10);
        }
    }

    // Draw terrain
    if (gameState.terrain) {
        gameState.terrain.forEach(obj => {
            if (obj.type === 'rampart') {
                // Draw ramparts (solid stone walls)
                ctx.fillStyle = '#666666';
                ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
                ctx.strokeStyle = '#444444';
                ctx.lineWidth = 2;
                ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

                // Add brick pattern
                ctx.strokeStyle = '#555555';
                ctx.lineWidth = 1;
                for (let bx = obj.x; bx < obj.x + obj.width; bx += 20) {
                    ctx.beginPath();
                    ctx.moveTo(bx, obj.y);
                    ctx.lineTo(bx, obj.y + obj.height);
                    ctx.stroke();
                }
                for (let by = obj.y; by < obj.y + obj.height; by += 15) {
                    ctx.beginPath();
                    ctx.moveTo(obj.x, by);
                    ctx.lineTo(obj.x + obj.width, by);
                    ctx.stroke();
                }
            } else if (obj.type === 'bush') {
                // Draw bushes (green cover)
                ctx.fillStyle = 'rgba(34, 139, 34, 0.6)';
                ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
                ctx.strokeStyle = 'rgba(0, 100, 0, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);

                // Add foliage pattern (cached to avoid random generation every frame - optimization)
                const bushKey = `${obj.x},${obj.y}`;
                if (!bushFoliageCache.has(bushKey)) {
                    // Generate foliage positions once and cache them
                    const foliage = [];
                    for (let i = 0; i < 5; i++) {
                        foliage.push({
                            cx: obj.x + Math.random() * obj.width,
                            cy: obj.y + Math.random() * obj.height
                        });
                    }
                    bushFoliageCache.set(bushKey, foliage);
                }

                // Draw cached foliage
                ctx.fillStyle = 'rgba(50, 205, 50, 0.4)';
                const foliage = bushFoliageCache.get(bushKey);
                for (const circle of foliage) {
                    ctx.beginPath();
                    ctx.arc(circle.cx, circle.cy, 8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
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
            const pulse = Math.sin(Date.now() / 200) * 0.2 + 1;
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
            ctx.strokeStyle = drop.type === 'super_powerup' ? '#FFFFFF' : '#FFFFFF';
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
                ctx.rotate(Date.now() / 500);
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
        const pulse = Math.sin(Date.now() / 200) * 0.2 + 1;
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
        ctx.rotate(Date.now() / 500);
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
        const pulse = Math.sin(Date.now() / 150) * 0.3 + 1;
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
        const flashAlpha = Math.sin(Date.now() / 100) * 0.5 + 0.5;
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
        ctx.rotate(Date.now() / 400);

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
            const pulseAlpha = Math.sin(Date.now() / 200) * 0.3 + 0.5;
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 25 * pulseAlpha;
        }

        // Show laser beam preparation warning
        if (player.laser_preparing && player.alive) {
            // Red pulsing warning effect
            const pulseAlpha = Math.sin(Date.now() / 150) * 0.4 + 0.6;
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
            const pulseAlpha = Math.sin(Date.now() / 100) * 0.3 + 0.5;
            ctx.shadowColor = '#00BFFF';
            ctx.shadowBlur = 30 * pulseAlpha;

            // Ice crystals around tank
            ctx.strokeStyle = 'rgba(0, 191, 255, ' + pulseAlpha + ')';
            ctx.lineWidth = 3;
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + Date.now() / 300;
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
            const pulseAlpha = Math.sin(Date.now() / 100) * 0.5 + 0.5;
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
            const pulseAlpha = Math.sin(Date.now() / 80) * 0.4 + 0.6;
            ctx.shadowColor = '#4169E1';
            ctx.shadowBlur = 40 * pulseAlpha;

            // Thick ice crystals
            ctx.strokeStyle = 'rgba(65, 105, 225, ' + pulseAlpha + ')';
            ctx.lineWidth = 4;
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2 + Date.now() / 200;
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

        // Add visual effects for active skills
        if (player.skill_active && player.alive) {
            if (player.skill === 'speed_demon') {
                // Speed Demon: Lightning aura
                const pulseAlpha = Math.sin(Date.now() / 100) * 0.4 + 0.6;
                ctx.shadowColor = '#FFFF00';
                ctx.shadowBlur = 35 * pulseAlpha;

                // Draw lightning bolts around tank
                ctx.strokeStyle = 'rgba(255, 255, 0, ' + pulseAlpha + ')';
                ctx.lineWidth = 2;
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2 + Date.now() / 500;
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
                const pulseAlpha = Math.sin(Date.now() / 150) * 0.3 + 0.5;
                ctx.shadowColor = '#9370DB';
                ctx.shadowBlur = 30 * pulseAlpha;
                ctx.globalAlpha = 0.6;
            }
        }

        // Draw tank body (SQUARE)
        ctx.fillStyle = player.color;
        ctx.fillRect(
            player.x - TANK_SIZE / 2,
            player.y - TANK_SIZE / 2,
            TANK_SIZE,
            TANK_SIZE
        );
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(
            player.x - TANK_SIZE / 2,
            player.y - TANK_SIZE / 2,
            TANK_SIZE,
            TANK_SIZE
        );

        // Draw custom icon on tank body
        if (player.icon) {
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(player.icon, player.x, player.y);
        }

        // Draw tank turret (line pointing in direction)
        if (player.alive) {
            ctx.strokeStyle = player.color;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(
                player.x + Math.cos(player.angle) * (TANK_SIZE / 2 + 10),
                player.y + Math.sin(player.angle) * (TANK_SIZE / 2 + 10)
            );
            ctx.stroke();

            // Draw turret tip
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(
                player.x + Math.cos(player.angle) * (TANK_SIZE / 2 + 10),
                player.y + Math.sin(player.angle) * (TANK_SIZE / 2 + 10),
                3,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }

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
        if (gameState.game_mode === 'duel' && player.team) {
            const teamLabel = player.team === 'red' ? '[RED]' : '[BLUE]';
            const teamColor = player.team === 'red' ? '#FF0000' : '#0000FF';
            ctx.fillStyle = teamColor;
            ctx.fillText(teamLabel, player.x, barY - 18 - captainOffset);
            ctx.fillStyle = player.color;
            ctx.font = 'bold 12px Arial';
            ctx.fillText(nameDisplay, player.x, barY - 5);
        } else {
            ctx.fillStyle = player.color;
            ctx.font = 'bold 12px Arial';
            ctx.fillText(nameDisplay, player.x, barY - 5);
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

// Focus name input on load
window.addEventListener('load', () => {
    playerNameInput.focus();
});
