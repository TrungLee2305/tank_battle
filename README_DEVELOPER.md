# Tank Battle - Developer Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Core Systems](#core-systems)
5. [Game Mechanics](#game-mechanics)
6. [Features Reference](#features-reference)
7. [Constants Reference](#constants-reference)
8. [How to Add/Modify Features](#how-to-addmodify-features)
9. [Troubleshooting](#troubleshooting)

---

## Overview

**Tank Battle** is a real-time multiplayer browser game where players control tanks, collect power-ups, use ultimate abilities, and fight each other in dynamically generated arenas.

### Technology Stack
- **Backend**: Python 3.x + Flask + Flask-SocketIO + Gevent
- **Frontend**: Vanilla JavaScript + HTML5 Canvas + Socket.IO Client
- **Real-time Communication**: WebSocket (Socket.IO)
- **Game Loop**: Server-authoritative at 30 ticks/second; state broadcast at 15 Hz (every 2nd tick)

### Key Concepts
- **Server-Authoritative**: All game logic runs on server; clients only render
- **Client Interpolation**: `renderPos` / `snakeRenderPos` maps lerp positions each RAF frame for smooth motion
- **Event-Driven**: Player actions (move, shoot, activate skill) sent via Socket.IO events
- **Tank Classes**: Skill is fixed per tank class — selected at join, not mid-game

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  game.js: Input capture, rendering, UI updates              │
│  Socket.IO Client: Sends player actions to server           │
│  HTML5 Canvas: Renders at monitor refresh rate (RAF loop)   │
│  Lerp system: renderPos / snakeRenderPos for smooth motion  │
└─────────────────────────────────────────────────────────────┘
                              ▲ │
                              │ │ WebSocket (Socket.IO)
                              │ ▼
┌─────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  tank_server.py: Main game server (~3400 lines)             │
│  ├─ Game Loop (30 ticks/sec): updates all entities          │
│  ├─ Broadcast (15 Hz): game_state every 2nd tick            │
│  ├─ Socket.IO Events: handles player actions                │
│  ├─ Game State: players, bullets, terrain, power-ups        │
│  └─ Collision Detection: AABB + penetration-depth push-out  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Player Input** → Client captures (WASD, mouse, click, C/X/T keys)
2. **Send to Server** → `key_state`, `rotate`, `shoot`, `activate_skill`, `activate_atomic_bomb`
3. **Server Updates** → 30 Hz game loop processes all entities
4. **Broadcast State** → `game_state` sent to all clients at 15 Hz
5. **Client Renders** → RAF loop lerps positions and draws current frame

---

## File Structure

```
tank_battle/
├── tank_server.py          # Main game server (~3400 lines)
│   ├── Constants          (~line 67)
│   ├── Terrain Generation (~line 400)
│   ├── Power-up Spawning  (~line 1200)
│   ├── Captain System     (~line 1270)
│   ├── Skills System      (~line 1436)
│   ├── Tank Creation      (~line 1870)
│   ├── Bot AI             (~line 2000)
│   ├── Tank Movement      (~line 2154)
│   ├── Game Loop          (~line 2648)
│   └── Socket.IO Handlers (~line 3100)
│
├── static/
│   ├── game.js             # Client-side game logic (~2700 lines)
│   │   ├── Tank renderers  (drawTankByClass, lines 53–450)
│   │   ├── Socket events   (~line 962)
│   │   ├── Input handling  (~line 1310)
│   │   ├── RAF render loop (~line 1480)
│   │   └── UI updates      (~line 2550)
│   └── style.css           # Game styling
│
├── templates/
│   └── index.html          # Main game page (~290 lines)
│       ├── Welcome screen  (tank class + color + mode + map selection)
│       ├── Death screen
│       ├── Game-over screen (Duel mode)
│       ├── Game canvas (1440×840)
│       └── Sidebar UI (stats, skill panel, bomb panel, leaderboard)
│
├── README_DEVELOPER.md     # This file
```

---

## Core Systems

### 1. Game Loop (tank_server.py ~line 2648)

**30 ticks/sec; broadcasts every 2nd tick (15 Hz)**

```python
def game_loop():
    while game_running:
        # 1. Update active skills & cooldowns
        update_skills(current_time)

        # 2. Update snake movement
        update_snake()

        # 3. Update all tanks
        for tank in players.values():
            if tank.get('is_bot'):
                update_bot_ai(tank)
            update_tank_movement(tank, current_time)
            check_supply_drop_collection(tank, current_time)
            check_shield_collection(tank, current_time)
            check_atomic_bomb_collection(tank)
            check_snake_collision(tank)

        # 4. Update bullets (move + collide)
        update_bullets(current_time)

        # 5. Expire power-up timers (per-type)
        update_powerups(current_time)

        # 6. Spawn new items
        spawn_supply_drops / spawn_snake / spawn_shield_drop
        # Atomic bomb: spawn 5s after world becomes bomb-free

        # 7. Broadcast (every 2nd tick)
        if tick_count % 2 == 0:
            socketio.emit('game_state', game_state)

        gevent.sleep(1.0 / GAME_TICK_RATE)
```

### 2. Tank Object Structure

```python
tank = {
    # Identity
    'id': 'unique_id',
    'name': 'PlayerName',
    'color': '#32CD32',
    'is_bot': False,

    # Position & movement
    'x': 720, 'y': 420,
    'angle': 0.0,
    'vx': 0, 'vy': 0,
    'keys': {'w': False, 'a': False, 's': False, 'd': False},

    # Health & scoring
    'health': 100, 'max_health': 100,
    'alive': True,
    'score': 0, 'kills': 0, 'deaths': 0,
    'shoot_cooldown': 0,
    'respawn_timer': 0,

    # Tank class & skill (fixed pairing)
    'tank_class': 'gun',           # 'gun'|'light'|'armored'|'gravity'|'transformer'
    'skill': 'laser_beam',         # determined by tank_class at join
    'skill_active': False,
    'skill_end_time': 0,
    'skill_cooldown_end': 0,

    # Power-ups (per-type independent timers)
    'powerups': [],                # active types list
    'powerup_end_times': {},       # {type: end_timestamp}

    # Spawn protection
    'invincible_until': 0,

    # Bush / visibility
    'hidden': False,
    'bush_index': -1,              # index of bush player is inside (-1 = none)

    # Atomic bomb
    'has_atomic_bomb': False,
    'bomb_preparing': False,
    'bomb_preparation_end': 0,
    'bomb_freezing': False,
    'bomb_freeze_end': 0,

    # Captain system
    'is_captain': False,
    'captain_targeted_until': 0,

    # Skill-specific states
    # Laser
    'laser_preparing': False,
    'laser_preparation_end': 0,
    'laser_cooling_down': False,
    'laser_cooldown_end': 0,
    # Gravity
    'gravity_preparing': False,
    'gravity_preparation_end': 0,
    'gravity_frozen_until': 0,
    # Transformer
    'transformer_damage_targets': {},  # {player_id: last_hit_tick}

    # Ricochet
    'bullet_bounces': 0,           # current ricochet count (0–2)

    # Emoji
    'emoji': None,
    'emoji_end_time': 0,

    # Team (Duel mode)
    'team': None,                  # 'red' | 'blue' | None
}
```

### 3. Collision Detection

**AABB** — tanks vs walls, bullets vs walls, bullets vs tanks
```python
if (x1 < x2 + w2 and x1 + w1 > x2 and
    y1 < y2 + h2 and y1 + h1 > y2):
    # Collision
```

**Penetration-depth push-out** — ghost mode wall exit
```python
# _push_out_of_wall(tank): find overlapping rampart,
# nudge along shallowest AABB axis
```

**Point-to-line distance** — laser beam vs tanks/snake
```python
t = max(0, min(1, dot_product / line_length_sq))
proj_x = lx + t * dx; proj_y = ly + t * dy
dist = sqrt((px - proj_x)**2 + (py - proj_y)**2)
```

**Distance check** — power-up/bomb collection
```python
if dx*dx + dy*dy < collection_radius**2:
    # Collected
```

### 4. Socket.IO Events

**Client → Server**
```javascript
socket.emit('join_game',           {name, map_type, game_mode, color, tank_class})
socket.emit('key_state',           {key: 'w', pressed: true})
socket.emit('rotate',              {angle: 1.57})
socket.emit('shoot')
socket.emit('activate_skill')       // C key — ultimate ability
socket.emit('activate_atomic_bomb') // X key
socket.emit('set_emoji',           {emoji: '😁'})
```

**Server → Client**
```javascript
socket.on('game_state',           (data) => {})  // 15 Hz
socket.on('player_joined',        (data) => {})
socket.on('tank_destroyed',       (data) => {})
socket.on('supply_collected',     (data) => {})
socket.on('skill_activated',      (data) => {})
socket.on('laser_fired',          (data) => {})
socket.on('gravity_pulse',        (data) => {})  // wave effect
socket.on('gravity_warning',      (data) => {})
socket.on('atomic_bomb_spawned',  (data) => {})
socket.on('atomic_bomb_collected',(data) => {})
socket.on('atomic_bomb_exploded', (data) => {})
socket.on('bomb_warning',         (data) => {})
socket.on('captain_selected',     (data) => {})
socket.on('captain_targeted',     (data) => {})
socket.on('snake_destroyed',      (data) => {})
socket.on('bots_spawned',         (data) => {})
socket.on('game_over',            (data) => {})  // Duel mode win
```

### 5. Per-type Power-up Timer System

Each power-up type expires independently using `powerup_end_times`:
```python
# On collect (refresh, not extend)
tank['powerup_end_times'][drop['type']] = current_time + POWERUP_DURATION

# On expire (update_powerups, runs every tick)
for ptype in list(tank.get('powerup_end_times', {}).keys()):
    if current_time >= tank['powerup_end_times'][ptype]:
        tank['powerups'] = [p for p in tank['powerups'] if p != ptype]
        del tank['powerup_end_times'][ptype]
```

Stack caps: `fan_shot` max 3×, `speed_boost` max 4×.

---

## Game Mechanics

### Movement & Physics

- Base speed: **5.0 px/tick**; diagonal normalized
- Hard clamped to arena bounds (no wrap)
- Bullets also blocked at boundaries
- Ghost mode: ignores wall AABB; pushed out at skill end

### Bullet System

- Speed: **10.12 px/tick** (9.2 +10%)
- Lifetime: **115 ticks** (~3.8 s)
- Damage: **25 HP**
- Ricochet: unlocks at 500 score (1 bounce), 1000 score (2 bounces)
- Blocked at arena boundary

### Combat

| Property | Value |
|---|---|
| Max health | 100 HP |
| Respawn time | 5 seconds |
| Spawn invincibility | 3 seconds |
| Kill reward | +100 score |
| Shoot cooldown | 15 ticks (0.5 s) |
| Fast fire cooldown | 3 ticks (0.1 s) |

### Power-up System

**Regular drops** (every 10 s, up to 2 active)
| Type | Effect | Duration |
|---|---|---|
| `fast_fire` | 10 shots/sec | 10 s |
| `fan_shot` | 3-bullet spread (+2 per stack) | 10 s each stack |
| `speed_boost` | 2× speed (+100% per stack) | 10 s each stack |

**Super drop** (every 60 s) — all 3 for 6 s

**Shield drop** (every 10 s) — invincibility 6 s (max 10 s remaining)

**Atomic Bomb** — single collectible item; world always has exactly one;
spawns 5 s after becoming bomb-free (no ground bomb + no carrier).

### Tank Classes & Ultimate Skills

Skills are **fixed per class** — selected at the welcome screen:

| Class | Skill | Key | Cooldown | Duration | Effect |
|---|---|---|---|---|---|
| **Gun Tank** | Laser Beam 🔴 | C | 30 s | 1 s prep + 0.5 s fire | Instant kill in 800 px line |
| **Light Tank** | Speed Demon ⚡ | C | 20 s | 4 s | 5× speed, +100 bullet damage |
| **Armored Tank** | Ghost Mode 👻 | C | 25 s | 5 s | Phase walls, full invincibility |
| **Gravity Tank** | Gravity Pulse 🌑 | C | 25 s | 1 s charge | Clears bullets 500 px, 50 HP + 3 s freeze in radius |
| **Transformer** | Transform 🤖 | C | 24 s | 8 s | +80% speed, 50 HP melee/0.5 s, no shooting |

### Atomic Bomb

- Press **X** to arm (3 s countdown, frozen in place)
- Kills all non-invincible players on detonation
- **2 s post-detonation freeze** for carrier
- Carrier is **always visible** (orange targeting rings, semi-transparent in bushes)
- On carrier death (including during arming): bomb **drops at death position**
- New bomb spawns **5 s** after world becomes bomb-free

### Captain System

- One random player is always designated Captain
- Captain gets: +50% speed, 2-fan bullets, +50% fire rate
- Every 30 s: "Hunt the Captain" broadcast — kill reward +1000 score
- Captain visible in bushes (golden crown, semi-transparent)
- Killing captain triggers new captain selection

### Duel Mode

- Red vs Blue teams (max 5 per team)
- Win condition: destroy enemy base OR reach 50 team kills
- Base health: 1000 HP; base size: 80 px
- Teams assigned alternately on join

### Bush / Stealth System

- Tanks inside a bush are `hidden` — invisible to others
- **Exceptions** (always drawn):
  - Own tank (0.7 alpha)
  - Captain (0.6 alpha)
  - Atomic bomb carrier (0.6 alpha)
  - Players sharing the **same bush** (0.75 alpha)
- `bush_index` per player enables same-bush detection

### Snake System

- Spawns every 30 s
- Size: 26 cells long × 3 cells wide (full AABB collision)
- Health: **2000 HP**; speed: **13.5 px/tick**
- Instant death on touch
- Bullet damage: 25 HP; laser damage: 100 HP per 0.5 s
- Destroy reward: **+500 score**
- Client lerp via `snakeRenderPos` for smooth rendering

### Ricochet System

| Score | Bounces |
|---|---|
| 0–499 | 0 |
| 500–999 | 1 |
| 1000+ | 2 |

### Emoji System

- Press **T** to open emoji picker (←/→ select, Enter confirm, Esc/T cancel)
- Emoji displayed above tank for **5 s**
- Server validates against official `EMOJI_LIST` (10 emojis)

### AI Bot System

- 1 human → spawn 2 bots; 2+ humans → remove all bots
- Bot behavior: random direction change every 2 s, shoot every 1.5 s
- Bots use skills and pick up power-ups
- Marked with 🤖 in name

---

## Features Reference

### Current Features (v3.0)

#### Core Gameplay
✅ Real-time multiplayer (20+ players optimized)  
✅ WASD movement, mouse aim, click/space shoot  
✅ 5 tank classes with unique visuals and ultimates  
✅ Health system (100 HP), kill/death tracking, score  
✅ Auto-respawn (5 s) with spawn protection (3 s)  
✅ Hard boundary clamping (no wrapping)  

#### Game Modes
✅ Free-for-All (FFA)  
✅ Duel (Red vs Blue, base destruction or 50 kills)  
✅ Voting — first player's choice sets map & mode  

#### Map Types
✅ Basic (1–2 walls, 1–2 bushes)  
✅ Advanced (3–4 walls, 2–3 bushes) — default  
✅ Maze (7–8 walls, 4–5 bushes)  

#### Power-ups & Items
✅ 3 regular power-ups with independent per-type timers  
✅ Additive stacking (fan ×3 max, speed ×4 max)  
✅ Super drop (all 3 abilities)  
✅ Shield drop (invincibility)  
✅ Atomic bomb (drop on death, 5 s respawn after gone)  

#### Ultimate Skills
✅ Laser Beam — instant kill ray, 30 s CD  
✅ Speed Demon — 5× speed, 20 s CD  
✅ Ghost Mode — phase walls, 25 s CD  
✅ Gravity Pulse — bullet clear + freeze, 25 s CD  
✅ Transformer — robot mode melee, 24 s CD  

#### Special Systems
✅ Captain system (bounty, +50% stats, crown targeting)  
✅ Atomic bomb targeting ring (carrier never fully hidden)  
✅ Ricochet bullets (score-gated, up to 2 bounces)  
✅ Emoji expressions (press T)  
✅ Same-bush visibility  
✅ Snake enemy (26 cells, 2000 HP, destroyable)  
✅ AI bots (auto-spawn solo, removed on 2+ players)  
✅ Death💀 emoji on kill confirmation  

#### UI/UX
✅ Welcome screen (class/color/mode/map selection with live previews)  
✅ Death screen with K/D and killer name  
✅ Game-over screen (Duel mode)  
✅ Leaderboard (top players)  
✅ Per-type power-up timer bars  
✅ Skill cooldown progress bar  
✅ Atomic bomb panel (arm countdown, post-detonation freeze)  
✅ Gravity wave / Transformer aura visual effects  
✅ Client-side bullet extrapolation (smooth 60fps+)  

---

## Constants Reference

```python
# Arena
ARENA_WIDTH  = 1440
ARENA_HEIGHT = 840
GAME_TICK_RATE = 30      # server ticks/sec; broadcast every 2nd tick = 15 Hz

# Tank
TANK_SIZE  = 30
TANK_SPEED = 5.0
TANK_MAX_HEALTH = 100

# Bullet
BULLET_SPEED    = 10.12  # px/tick (9.2 +10%)
BULLET_DAMAGE   = 25
BULLET_LIFETIME = 115    # ticks
SHOOT_COOLDOWN  = 15     # ticks (0.5 s)

# Ricochet
RICOCHET_SCORE_1 = 500   # unlock 1st bounce
RICOCHET_SCORE_2 = 1000  # unlock 2nd bounce

# Power-ups
SUPPLY_DROP_INTERVAL  = 10  # s
POWERUP_DURATION      = 10  # s
SUPER_DROP_INTERVAL   = 60  # s
SUPER_POWERUP_DURATION = 6  # s
SHIELD_DROP_INTERVAL  = 10  # s
SHIELD_DURATION       = 6   # s

# Atomic Bomb
ATOMIC_BOMB_RESPAWN_DELAY = 5    # s after world bomb-free
ATOMIC_BOMB_PREPARATION   = 3.0  # s arming phase
ATOMIC_BOMB_FREEZE        = 2.0  # s post-detonation freeze

# Snake
SNAKE_INTERVAL     = 30    # s between spawns
SNAKE_CELL_SIZE    = 30    # px
SNAKE_WIDTH_CELLS  = 3
SNAKE_LENGTH_CELLS = 26
SNAKE_SPEED        = 13.5  # px/tick (-10% from original)

# Captain
CAPTAIN_SPEED_MULTIPLIER     = 1.5
CAPTAIN_FIRE_RATE_MULTIPLIER = 1.5
CAPTAIN_KILL_REWARD          = 1000
CAPTAIN_TARGET_INTERVAL      = 30   # s between bounty pulses
CAPTAIN_TARGET_DURATION      = 5.0  # s targeting visual

# Skills — per-skill cooldowns
SKILL_COOLDOWN_SPEED_DEMON = 20  # s
SKILL_COOLDOWN_LASER_BEAM  = 30  # s
SKILL_COOLDOWN_GHOST_MODE  = 25  # s
SKILL_COOLDOWN_GRAVITY     = 25  # s
SKILL_COOLDOWN_TRANSFORMER = 24  # s

# Speed Demon
SKILL_SPEED_DEMON_DURATION     = 4      # s
SKILL_SPEED_DEMON_SPEED_MULT   = 5.0    # 5× speed
SKILL_SPEED_DEMON_DAMAGE_BONUS = 100

# Laser Beam
SKILL_LASER_BEAM_PREPARATION = 1.0  # s charge
SKILL_LASER_BEAM_DURATION    = 0.5  # s fire
SKILL_LASER_BEAM_COOLDOWN    = 1.0  # s post-fire freeze
SKILL_LASER_RANGE            = 800  # px

# Ghost Mode
SKILL_GHOST_MODE_DURATION = 5  # s

# Gravity Pulse
SKILL_GRAVITY_PREPARATION    = 1.0   # s charge
SKILL_GRAVITY_RADIUS         = 500   # px
SKILL_GRAVITY_DAMAGE         = 50    # HP
SKILL_GRAVITY_FREEZE_DURATION = 3.0  # s targets frozen

# Transformer
SKILL_TRANSFORMER_DURATION     = 8.0   # s
SKILL_TRANSFORMER_SPEED_MULT   = 0.8   # +80% speed (additive)
SKILL_TRANSFORMER_DAMAGE       = 50    # HP per melee hit
SKILL_TRANSFORMER_DAMAGE_TICKS = 15    # ticks between hits

# Bots
BOT_MOVE_CHANGE_INTERVAL = 60  # ticks (2 s)
BOT_SHOOT_INTERVAL       = 45  # ticks (1.5 s)

# Duel Mode
DUEL_MAX_TEAM_SIZE = 5
DUEL_WIN_KILLS     = 50
DUEL_BASE_HEALTH   = 1000
DUEL_BASE_SIZE     = 80

# Emoji
EMOJI_DISPLAY_DURATION = 5.0  # s
```

---

## How to Add/Modify Features

### Adding a New Tank Class + Skill

**1. Add skill constants** (tank_server.py, constants block)
```python
SKILL_COOLDOWN_MYSKILL  = 20
SKILL_MYSKILL_DURATION  = 5
```

**2. Add to `CLASS_TO_SKILL` in `handle_join_game`**
```python
CLASS_TO_SKILL = {
    'gun': 'laser_beam', 'light': 'speed_demon',
    'armored': 'ghost_mode', 'gravity': 'gravity',
    'transformer': 'transformer',
    'myclass': 'myskill'
}
```

**3. Implement skill logic in `update_skills`**
```python
if tank['skill_active'] and tank['skill'] == 'myskill':
    # apply effect every tick
    pass
```

**4. Add activate branch in `handle_activate_skill`**
```python
skill_durations = {
    ...,
    'myskill': SKILL_MYSKILL_DURATION
}
_cooldowns = {
    ...,
    'myskill': SKILL_COOLDOWN_MYSKILL
}
```

**5. Add tank renderer in `drawTankByClass` (game.js)**
```javascript
} else if (tankClassSafe === 'myclass') {
    // draw body and turret
}
```

**6. Add class card in `index.html`**
```html
<label class="tank-class-option">
    <input type="radio" name="tank-class" value="myclass">
    <div class="tank-class-card">
        <canvas class="tank-preview-canvas" data-class="myclass" width="140" height="110"></canvas>
        <strong>My Tank</strong>
        <p class="tank-class-desc">Description</p>
        <p class="tank-class-ult">🆕 Ultimate: MySkill — effect, Xs</p>
    </div>
</label>
```

### Adding a New Power-up

**1. Add to `available_types` in `spawn_supply_drops`**
```python
available_types = ['fast_fire', 'fan_shot', 'speed_boost', 'my_powerup']
```

**2. Apply effect in `update_tank_movement` or bullet logic**
```python
if 'my_powerup' in tank.get('powerups', []):
    # apply effect
```

**3. Set per-type timer in `check_supply_drop_collection`** (already handled generically by the `powerup_end_times` system)

**4. Add client visual in `drawSupplyDrops` (game.js)**
```javascript
if (drop.type === 'my_powerup') {
    ctx.fillText('⭐', drop.x, drop.y);
}
```

### Modifying Speed/Balance

```python
TANK_SPEED   = 5.0   # base speed
BULLET_SPEED = 10.12 # bullet px/tick
SNAKE_SPEED  = 13.5  # snake px/tick

# To speed up everything
GAME_TICK_RATE = 60  # doubles simulation speed
```

---

## Troubleshooting

### Common Issues

**Port already in use**
```bash
pkill -f "python tank_server.py"
python tank_server.py
```

**Clients not receiving updates**
```python
# Confirm broadcast runs: check tick_count % 2 == 0 path
# Confirm socketio.emit('game_state', ...) is reached
```

**Tank class mismatch (joined as wrong class)**
```python
# Ensure CLASS_TO_SKILL in handle_join_game includes the new class
# Ensure create_tank receives the correct tank_class argument
```

**Ghost stuck in wall after skill end**
```python
# _push_out_of_wall(tank) is called on skill end in update_skills
# Verify terrain_ramparts list is populated (not terrain)
```

**Power-up never expires**
```python
# Check update_powerups() runs every tick
# Check powerup_end_times dict uses correct type key string
```

**Atomic bomb not dropping on death**
```python
# death handler must call drop_atomic_bomb_at(tank['x'], tank['y'])
# before setting has_atomic_bomb = False
# Three death paths: bullet hit, snake hit, update_skills cancel
```

### Performance Notes

- Broadcast at 15 Hz (every 2 ticks) to halve network load vs 30 Hz
- `terrain_ramparts` / `terrain_bushes` pre-split lists avoid type-checking in hot loops
- Bullet `_lastBulletStateTime` + `vx/vy` extrapolation on client removes need for 30 Hz bullet updates
- `renderPos` lerp runs at RAF rate — smooth even if server is at 15 Hz

### Testing Checklist

Before deploying:
- [ ] Server starts without errors (`python3 tank_server.py`)
- [ ] `python3 -c "import ast; ast.parse(open('tank_server.py').read()); print('OK')"` passes
- [ ] `node --check static/game.js` passes
- [ ] All 5 tank classes selectable and join with correct skill
- [ ] All 5 ultimates activate, deal damage/effect, cooldown correctly
- [ ] Power-ups stack and expire independently per type
- [ ] Atomic bomb: drop → pick up → X to arm → detonate; drop on death
- [ ] Bush stealth: captain and bomb carrier always visible
- [ ] Duel mode: teams assigned, base takes damage, win condition triggers
- [ ] Snake spawns, moves, deals instant death, destroyable
- [ ] Bots spawn solo, removed on 2 human players joining

---

## Development Workflow

### Start / Restart Server
```bash
# Start
python tank_server.py

# Kill and restart
pkill -f "python tank_server.py" && python tank_server.py

# Check running
ps aux | grep tank_server.py
```

### Key In-Game Controls
| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Aim turret |
| Click / Space | Shoot |
| C | Activate ultimate |
| X | Arm atomic bomb |
| T | Open emoji picker |

---

## Version History

### v3.0 (Current) — April 2026
- Added Gravity Tank class (Gravity Pulse ultimate)
- Added Transformer Tank class (robot melee mode)
- Per-skill individual cooldowns (20 / 24 / 25 / 25 / 30 s)
- Per-type independent power-up expiry timers with additive stacking
- Atomic bomb drops on carrier death (including during arming)
- Bomb carrier targeting rings + always visible in bushes
- Atomic bomb: fixed 60 s timer replaced with 5 s after bomb-free
- Ghost mode: push-out-of-wall on skill end
- Same-bush player visibility
- Captain starts with 2 fan bullets (not 3)
- Hard boundary clamp (no wrapping), bullets blocked at edges
- Bullet speed +10%, snake speed −10%
- Snake client-side lerp for smooth rendering

### v2.1 — Early 2026
- Laser beam snake damage (100 HP / 0.5 s)
- AI bot system (auto-spawn solo)
- In-game map/mode selection via first-player vote
- Ricochet system (score-gated)
- Captain system
- Duel mode (Red vs Blue teams)
- Emoji expression system

### v2.0 — 2025
- Ultimate skills (Laser Beam, Speed Demon, Ghost Mode)
- Snake enemy system
- Shield power-up
- Player customization (color, class)

### v1.0 — Initial Release
- Basic multiplayer, 3 map types, power-ups, kill/death tracking

---

## Resources

- Flask-SocketIO: https://flask-socketio.readthedocs.io/
- Socket.IO client: https://socket.io/docs/v4/
- HTML5 Canvas API: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- 2D Collision Detection: https://developer.mozilla.org/en-US/docs/Games/Techniques/2D_collision_detection

```bash
# Install dependencies
pip install flask flask-socketio flask-cors gevent gevent-websocket
```

---

**Last Updated**: April 2026 (v3.0)  
**Maintainer**: TrungLe  
**Default Port**: 8051  
