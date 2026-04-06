# Tank Battle - Developer Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Core Systems](#core-systems)
5. [Game Mechanics](#game-mechanics)
6. [Features Reference](#features-reference)
7. [Code Locations](#code-locations)
8. [How to Add/Modify Features](#how-to-addmodify-features)
9. [Troubleshooting](#troubleshooting)

---

## Overview

**Tank Battle** is a real-time multiplayer browser game where players control tanks, collect power-ups, use ultimate abilities, and fight each other in dynamically generated arenas.

### Technology Stack
- **Backend**: Python 3.x + Flask + Flask-SocketIO + Gevent
- **Frontend**: Vanilla JavaScript + HTML5 Canvas + Socket.IO Client
- **Real-time Communication**: WebSocket (Socket.IO)
- **Game Loop**: Server-authoritative at 30 ticks/second

### Key Concepts
- **Server-Authoritative**: All game logic runs on server, clients only render
- **Real-time Updates**: Game state broadcast 30 times per second
- **Event-Driven**: Player actions (move, shoot, activate skill) sent via Socket.IO events

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  game.js: Handles rendering, input capture, UI updates      │
│  Socket.IO Client: Sends player actions to server           │
│  HTML5 Canvas: Renders game at 60 FPS                       │
└─────────────────────────────────────────────────────────────┘
                              ▲ │
                              │ │ WebSocket (Socket.IO)
                              │ ▼
┌─────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  tank_server.py: Main game server                           │
│  ├─ Game Loop (30 ticks/sec): Updates all entities          │
│  ├─ Socket.IO Events: Handles player actions                │
│  ├─ Game State: players, bullets, terrain, power-ups        │
│  └─ Collision Detection: AABB, point-to-line algorithms     │
└─────────────────────────────────────────────────────────────┘
                              │ │
                              │ ▼
┌─────────────────────────────────────────────────────────────┐
│                       CLIENT RENDERING                       │
├─────────────────────────────────────────────────────────────┤
│  Receives game_state every 33ms (30 FPS)                    │
│  Draws: tanks, bullets, terrain, power-ups, snake, UI       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Player Input** → Client captures (WASD, mouse, click, C key)
2. **Send to Server** → Socket.IO events (`key_state`, `rotate`, `shoot`, `activate_skill`)
3. **Server Updates** → Game loop processes all entities
4. **Broadcast State** → `game_state` event sent to all clients
5. **Client Renders** → Canvas draws the current frame

---

## File Structure

```
tank_battle/
├── tank_server.py          # Main game server (1822 lines)
│   ├── Constants (lines 60-126)
│   ├── Terrain Generation (lines 154-413)
│   ├── Power-ups (lines 476-787)
│   ├── Snake System (lines 563-686)
│   ├── Skills System (lines 806-973)
│   ├── Bot AI (lines 922-1091)
│   ├── Game Loop (lines 1342-1594)
│   └── Socket.IO Handlers (lines 1605-1793)
│
├── static/
│   ├── game.js             # Client-side game logic (1050 lines)
│   │   ├── Socket.IO setup (lines 1-51)
│   │   ├── Input handling (lines 178-260)
│   │   ├── Rendering (lines 261-900)
│   │   └── UI updates (lines 909-1025)
│   └── style.css           # Game styling (800+ lines)
│
├── templates/
│   └── index.html          # Main game page (236 lines)
│       ├── Welcome screen (lines 20-153)
│       ├── Death screen (lines 156-164)
│       ├── Game canvas (line 18)
│       └── Sidebar UI (lines 169-224)
│
├── README_DEVELOPER.md     # This file
├── TEST_LASER_SNAKE.md     # Testing guide for laser beam
└── FIXES_SUMMARY.md        # Version 2.1 changes log
```

---

## Core Systems

### 1. Game Loop (tank_server.py:1342-1594)

**Runs at 30 ticks per second**

```python
def game_loop():
    while game_running:
        # 1. Check bot spawning/removal
        check_and_manage_bots()

        # 2. Update all tanks
        for tank in players.values():
            if tank.get('is_bot'):
                update_bot_ai(tank)      # Bot AI
            update_tank_movement(tank)    # Physics
            check_supply_drop_collection(tank)  # Power-ups
            check_shield_collection(tank)
            check_snake_collision(tank)   # Snake instant death

        # 3. Update bullets
        update_bullets()  # Move, collide with walls/tanks/snake

        # 4. Update power-ups and skills
        update_powerups()  # Expire timers
        update_skills()    # Handle laser beam, skill durations

        # 5. Update snake
        update_snake()  # Move snake, check if off-screen

        # 6. Spawn new items
        if time_for_supply_drops:
            spawn_supply_drops()
        if time_for_snake:
            spawn_snake()

        # 7. Broadcast game state to all clients
        socketio.emit('game_state', game_state)

        # 8. Sleep to maintain 30 FPS
        gevent.sleep(1.0 / 30)
```

### 2. Collision Detection

**AABB (Axis-Aligned Bounding Box)**
Used for: tanks vs walls, bullets vs walls, bullets vs tanks
```python
if (x1 < x2 + w2 and x1 + w1 > x2 and
    y1 < y2 + h2 and y1 + h1 > y2):
    # Collision!
```

**Point-to-Line Distance**
Used for: laser beam vs tanks, laser beam vs snake
```python
# Project point onto line
t = max(0, min(1, dot_product / line_length_sq))
proj_x = line_start_x + t * dx
proj_y = line_start_y + t * dy
distance = sqrt((point_x - proj_x)^2 + (point_y - proj_y)^2)
```

**Distance Check**
Used for: tank vs supply drops, tank vs shield
```python
distance = sqrt((x1 - x2)^2 + (y1 - y2)^2)
if distance < collection_radius:
    # Collected!
```

### 3. Socket.IO Events

**Client → Server**
```javascript
// Player actions
socket.emit('join_game', {name, map_type, color, icon, skill})
socket.emit('key_state', {key: 'w', pressed: true})
socket.emit('rotate', {angle: 1.57})
socket.emit('shoot')
socket.emit('activate_skill')
```

**Server → Client**
```javascript
// Game updates
socket.on('game_state', (data) => {})      // 30 times/sec
socket.on('player_joined', (data) => {})
socket.on('tank_destroyed', (data) => {})
socket.on('supply_collected', (data) => {})
socket.on('skill_activated', (data) => {})
socket.on('snake_destroyed', (data) => {})
socket.on('bots_spawned', (data) => {})
```

### 4. State Management

**Server Global State**
```python
players = {}           # {player_id: tank_data}
bots = {}             # {bot_id: tank_data}
bullets = []          # List of bullet objects
terrain = []          # List of walls and bushes
supply_drops = []     # Active power-ups on map
snake = None          # Current snake (or None)
shield_drop = None    # Shield power-up (or None)
```

**Tank Object Structure**
```python
tank = {
    'id': 'unique_id',
    'name': 'PlayerName',
    'x': 720, 'y': 420,
    'angle': 0.0,
    'vx': 0, 'vy': 0,
    'color': '#32CD32',
    'icon': '⭐',
    'health': 100,
    'max_health': 100,
    'alive': True,
    'score': 0,
    'kills': 0,
    'deaths': 0,
    'shoot_cooldown': 0,
    'respawn_timer': 0,
    'powerups': [],              # ['fast_fire', 'fan_shot', 'speed_boost']
    'powerup_end_time': 0,
    'invincible_until': time + 3,
    'skill': 'speed_demon',      # 'speed_demon' | 'laser_beam' | 'ghost_mode'
    'skill_active': False,
    'skill_end_time': 0,
    'skill_cooldown_end': 0,
    'keys': {'w': False, 'a': False, 's': False, 'd': False},
    'is_bot': False              # True for AI bots
}
```

---

## Game Mechanics

### Movement & Physics

**Tank Movement** (tank_server.py:1094-1184)
- Speed: 5 pixels/tick (or 10 with speed boost)
- Diagonal movement normalized (same speed in all directions)
- Collision with walls prevents movement
- Wraps around screen edges

**Bullet Movement** (tank_server.py:1186-1322)
- Speed: 9.2 pixels/tick
- Lifetime: 115 ticks (~3.8 seconds)
- Wraps around screen edges
- Destroyed on wall collision

### Combat System

**Shooting** (tank_server.py:1708-1758)
- Cooldown: 15 ticks (0.5 seconds)
- Damage: 25 HP per bullet
- Fast Fire: 3 tick cooldown (10 shots/sec)
- Fan Shot: 3 bullets in spread pattern

**Tank Health**
- Max: 100 HP
- Death: Respawns after 5 seconds
- Kill reward: +100 points
- Spawn protection: 3 seconds invincibility

### Power-up System

**Regular Power-ups** (spawn every 10 seconds)
```python
'fast_fire'     # 10 shots/sec for 10 seconds
'fan_shot'      # 3 bullets spread for 10 seconds
'speed_boost'   # 2x speed for 10 seconds
```

**Super Power-up** (spawns every 60 seconds)
```python
'super_powerup' # All 3 abilities for 6 seconds
```

**Shield Drop** (spawns every 10 seconds)
```python
'invincibility_shield' # 6 seconds invincibility
```

### Ultimate Skills System

**Press 'C' to activate** (30 second cooldown after skill ends)

**Speed Demon** ⚡ (4 seconds)
- 5x movement speed (400% increase)
- +100 damage per bullet
- Location: tank_server.py:1486-1487

**Laser Beam** 🔴 (3 seconds)
- Instant kill any tank in laser path
- Damages snake: 100 HP every 0.5s
- Range: 1500 pixels
- Width: 50 pixels
- Location: tank_server.py:813-906

**Ghost Mode** 👻 (5 seconds)
- Phase through walls
- Total invincibility
- Cannot be damaged
- Location: tank_server.py:1490-1491

### Map Generation

**Three map types** (terrain_generated on first player join)

**Basic** (tank_server.py:154-216)
- 1-2 walls
- 1-2 bushes
- Fast & Simple

**Advanced** (tank_server.py:218-292)
- 3-4 walls
- 2-3 bushes
- Balanced (default)

**Maze** (tank_server.py:294-378)
- 7-8 walls
- 4-5 bushes
- Tactical & Complex

**Terrain Features**
- Walls: Block movement and bullets
- Bushes: Hide tanks (invisible to others)
- Spacing: 60-90 pixel gaps between objects

### Snake System

**Huge Snake** (tank_server.py:563-686)
- Spawns every 30 seconds
- Size: 13 cells long × 3 cells wide = 39 total cells
- Health: 2000 HP
- Speed: 5 pixels/tick
- Damage: Instant death on touch
- Bullet Damage: 25 HP per bullet
- Laser Damage: 100 HP every 0.5 seconds
- Destroy Reward: +500 points
- Moves in 8 directions (including diagonals)
- Crosses screen and disappears

### AI Bot System

**Auto-spawn Logic** (tank_server.py:1076-1091)
- 1 human player → Spawn 2 bots
- 2+ human players → Remove all bots

**Bot Behavior** (tank_server.py:1020-1073)
- Random movement: Changes direction every 2 seconds
- Random shooting: Fires every 1.5 seconds
- Uses power-ups and skills
- Respawns like human players
- Marked with 🤖 emoji

---

## Features Reference

### Current Features (v2.1)

#### Core Gameplay
✅ Real-time multiplayer (up to 10+ players)
✅ Smooth tank movement (WASD)
✅ Mouse aim with turret rotation
✅ Shooting with cooldown
✅ Health system (100 HP)
✅ Kill/death tracking
✅ Score system
✅ Auto-respawn (5 seconds)

#### Combat & Power-ups
✅ 3 Regular power-ups (fast fire, fan shot, speed boost)
✅ 1 Super power-up (all abilities)
✅ 1 Shield drop (invincibility)
✅ Power-up stacking
✅ Visual power-up indicators

#### Ultimate Skills
✅ Speed Demon (5x speed, +100 damage, 4s)
✅ Laser Beam (instant kill, 3s)
✅ Ghost Mode (phase through walls, 5s)
✅ 30 second cooldown
✅ Press 'C' to activate

#### Map System
✅ 3 map types (Basic, Advanced, Maze)
✅ In-game map selection
✅ First player chooses map
✅ Dynamic terrain generation
✅ Bush stealth system

#### Enemy System
✅ Huge Snake (2000 HP)
✅ 8-directional movement
✅ 39 cell collision (full body)
✅ Instant death on touch
✅ Destroyable by bullets/laser
✅ +500 points reward

#### AI System
✅ Auto-spawn 2 bots for solo play
✅ Random movement AI
✅ Random shooting AI
✅ Bot respawning
✅ Auto-removal when players join

#### Customization
✅ Custom tank colors
✅ 10 tank icons (⭐🔥💎⚡👑🎯💀🌟🚀🎮)
✅ Player names
✅ Skill selection

#### UI/UX
✅ Welcome screen with customization
✅ Death screen with stats
✅ Leaderboard (top 10)
✅ Player count
✅ Health bars above tanks
✅ Crosshair
✅ Skill cooldown indicator
✅ Power-up timer
✅ Notifications
✅ Spawn protection indicator

---

## Code Locations

### Constants (tank_server.py:60-126)

```python
# Arena
ARENA_WIDTH = 1440
ARENA_HEIGHT = 840

# Tank
TANK_SIZE = 30
TANK_SPEED = 5.0
TANK_MAX_HEALTH = 100

# Bullet
BULLET_SPEED = 9.2
BULLET_DAMAGE = 25
BULLET_LIFETIME = 115
SHOOT_COOLDOWN = 15  # ticks

# Power-ups
SUPPLY_DROP_INTERVAL = 10      # seconds
POWERUP_DURATION = 10          # seconds
SUPER_DROP_INTERVAL = 60       # seconds
SUPER_POWERUP_DURATION = 6     # seconds
SHIELD_DROP_INTERVAL = 10      # seconds
SHIELD_DURATION = 6            # seconds

# Snake
SNAKE_INTERVAL = 30            # seconds
SNAKE_CELL_SIZE = 30
SNAKE_WIDTH_CELLS = 3
SNAKE_LENGTH_CELLS = 13
SNAKE_SPEED = 5

# Skills
SKILL_COOLDOWN = 30                    # seconds
SKILL_SPEED_DEMON_DURATION = 4         # seconds
SKILL_SPEED_DEMON_SPEED_MULT = 5.0
SKILL_SPEED_DEMON_DAMAGE_BONUS = 100
SKILL_LASER_BEAM_DURATION = 3          # seconds
SKILL_LASER_RANGE = 1500
SKILL_GHOST_MODE_DURATION = 5          # seconds

# Bots
BOT_MOVE_CHANGE_INTERVAL = 60  # ticks (2 seconds)
BOT_SHOOT_INTERVAL = 45        # ticks (1.5 seconds)
```

### Key Functions Reference

**Terrain Generation**
- `generate_terrain_basic()` - lines 154-216
- `generate_terrain_advanced()` - lines 218-292
- `generate_terrain_maze()` - lines 294-378
- `check_terrain_overlap()` - lines 142-151

**Power-ups**
- `spawn_supply_drops()` - lines 476-518
- `spawn_super_drop()` - lines 521-560
- `spawn_shield_drop()` - lines 688-717
- `check_supply_drop_collection()` - lines 745-786

**Snake**
- `spawn_snake()` - lines 563-612
- `update_snake()` - lines 614-628
- `check_snake_collision()` - lines 630-685

**Skills**
- `update_skills()` - lines 806-973
- Laser beam damage to snake - lines 825-906
- Laser beam kills tanks - lines 908-964

**Bot AI**
- `create_bot()` - lines 922-978
- `spawn_bots()` - lines 981-995
- `remove_all_bots()` - lines 998-1017
- `update_bot_ai()` - lines 1020-1073
- `check_and_manage_bots()` - lines 1076-1091

**Tank Management**
- `create_tank()` - lines 976-1019
- `update_tank_movement()` - lines 1094-1184
- `update_bullets()` - lines 1186-1322

**Socket.IO Handlers**
- `handle_connect()` - lines 1605-1613
- `handle_disconnect()` - lines 1615-1635
- `handle_join_game()` - lines 1637-1687
- `handle_key_state()` - lines 1689-1699
- `handle_rotate()` - lines 1701-1709
- `handle_shoot()` - lines 1711-1758
- `handle_activate_skill()` - lines 1760-1793

---

## How to Add/Modify Features

### Adding a New Power-up

**1. Add to server constants** (tank_server.py)
```python
NEW_POWERUP_DURATION = 10  # seconds
```

**2. Add to spawn function** (tank_server.py:476-518)
```python
available_types = ['fast_fire', 'fan_shot', 'speed_boost', 'new_powerup']
```

**3. Implement effect** (tank_server.py:1711-1758)
```python
if 'new_powerup' in tank['powerups']:
    # Apply effect
    pass
```

**4. Add client-side rendering** (game.js)
```javascript
// In drawSupplyDrops function
if (drop.type === 'new_powerup') {
    // Draw custom visual
}
```

### Adding a New Ultimate Skill

**1. Add constants** (tank_server.py:118-125)
```python
SKILL_NEW_SKILL_DURATION = 5  # seconds
SKILL_NEW_SKILL_PARAMETER = 100
```

**2. Update create_tank** (tank_server.py:976)
```python
tank_skill = skill if skill in ['speed_demon', 'laser_beam', 'ghost_mode', 'new_skill'] else 'speed_demon'
```

**3. Implement skill logic** (tank_server.py:806-973)
```python
if tank['skill_active'] and tank['skill'] == 'new_skill':
    # Apply skill effect every tick
    pass
```

**4. Update activate handler** (tank_server.py:1760-1793)
```python
if skill == 'new_skill':
    duration = SKILL_NEW_SKILL_DURATION
```

**5. Add to HTML** (index.html:81-113)
```html
<label class="skill-option">
    <input type="radio" name="skill" value="new_skill">
    <div class="skill-card">
        <div class="skill-icon">🆕</div>
        <strong>New Skill</strong>
        <p class="skill-desc">Description</p>
        <p class="skill-cooldown">5s Duration • 30s CD</p>
    </div>
</label>
```

**6. Add to client** (game.js:940-952)
```javascript
const skillNames = {
    'speed_demon': 'Speed Demon',
    'laser_beam': 'Laser Beam',
    'ghost_mode': 'Ghost Mode',
    'new_skill': 'New Skill'
};
```

### Adding a New Map Type

**1. Create generation function** (tank_server.py)
```python
def generate_terrain_custom():
    """Generate custom map"""
    global terrain
    terrain = []

    # Generate walls
    num_walls = random.randint(5, 7)
    # ... implementation

    # Generate bushes
    num_bushes = random.randint(3, 5)
    # ... implementation
```

**2. Add to terrain generator** (tank_server.py:395-413)
```python
if map_type == 'custom':
    generate_terrain_custom()
```

**3. Add to HTML** (index.html:115-143)
```html
<label class="map-option">
    <input type="radio" name="map-type" value="custom">
    <div class="map-card">
        <strong>Custom</strong>
        <p>5-7 walls, 3-5 bushes</p>
        <p class="map-diff">🎨 Creative</p>
    </div>
</label>
```

**4. Add to map votes** (tank_server.py:1649)
```python
if map_choice in ['basic', 'advanced', 'maze', 'custom']:
```

### Modifying Game Constants

**Speed up gameplay:**
```python
GAME_TICK_RATE = 60  # From 30 to 60 FPS
TANK_SPEED = 10.0    # From 5.0 (faster tanks)
BULLET_SPEED = 15.0  # From 9.2 (faster bullets)
```

**Increase difficulty:**
```python
TANK_MAX_HEALTH = 50          # From 100 (less health)
SNAKE_SPEED = 10              # From 5 (faster snake)
SUPPLY_DROP_INTERVAL = 20     # From 10 (fewer power-ups)
```

**Change skill balance:**
```python
SKILL_COOLDOWN = 60                    # From 30 (longer cooldown)
SKILL_SPEED_DEMON_DURATION = 2         # From 4 (shorter duration)
SKILL_LASER_BEAM_DURATION = 1          # From 3 (shorter)
```

### Adding New Bot Behaviors

**Example: Smart bot that targets nearest player**

```python
def update_bot_ai_smart(bot: dict):
    """Smarter bot AI - targets nearest player"""
    if not bot['alive']:
        return

    # Find nearest human player
    nearest_player = None
    min_distance = float('inf')

    for player_id, player in players.items():
        if player.get('is_bot') or not player['alive']:
            continue

        distance = math.sqrt((bot['x'] - player['x'])**2 +
                            (bot['y'] - player['y'])**2)
        if distance < min_distance:
            min_distance = distance
            nearest_player = player

    if nearest_player:
        # Move towards player
        angle_to_player = math.atan2(
            nearest_player['y'] - bot['y'],
            nearest_player['x'] - bot['x']
        )

        # Set movement keys based on angle
        bot['keys']['w'] = abs(angle_to_player) < math.pi / 4
        bot['keys']['s'] = abs(angle_to_player) > 3 * math.pi / 4
        bot['keys']['a'] = angle_to_player < 0
        bot['keys']['d'] = angle_to_player > 0

        # Aim at player
        bot['angle'] = angle_to_player

        # Shoot if close enough
        if min_distance < 500 and bot['shoot_cooldown'] == 0:
            # Fire bullet
            bullet = create_bullet(bot, bot['angle'])
            bullets.append(bullet)
            bot['shoot_cooldown'] = SHOOT_COOLDOWN
```

---

## Troubleshooting

### Common Issues

**Issue: Port already in use**
```bash
# Solution: Kill existing server
pkill -f "python tank_server.py"

# Or use different port
python tank_server.py 8052
```

**Issue: Clients not receiving updates**
```python
# Check game loop is running
print(f'Game loop tick - Players: {len(players)}')  # Add to game_loop()

# Check socketio.emit is being called
socketio.emit('game_state', game_state, namespace='/')
```

**Issue: Collision detection not working**
```python
# Add debug logging
if check_terrain_collision(x, y, w, h):
    print(f'Collision at ({x}, {y})')
```

**Issue: Snake not spawning**
```python
# Check terrain is generated
if not terrain_generated:
    print('ERROR: Terrain not generated yet!')

# Check timer
if current_time - last_snake_time >= SNAKE_INTERVAL:
    print(f'Spawning snake at {current_time}')
```

**Issue: Laser beam not damaging**
```python
# Check skill is active
if tank['skill_active'] and tank['skill'] == 'laser_beam':
    print(f'Laser active for {tank["name"]}')

# Check snake exists
if snake is not None:
    print(f'Snake at ({snake["x"]}, {snake["y"]}) HP: {snake["health"]}')
```

### Performance Issues

**High CPU usage**
```python
# Reduce tick rate
GAME_TICK_RATE = 20  # From 30

# Reduce collision checks
# Only check nearby objects instead of all
```

**High network usage**
```python
# Send compressed game state
# Only send changed data instead of full state

# Reduce update frequency for distant players
```

### Testing Checklist

**Before deploying changes:**
- [ ] Server starts without errors
- [ ] Players can join and spawn
- [ ] Movement and shooting work
- [ ] Power-ups spawn and are collectible
- [ ] Skills activate and work correctly
- [ ] Snake spawns and moves
- [ ] Collisions work properly
- [ ] Bots spawn for solo players
- [ ] Map generation works for all types
- [ ] Clients receive updates smoothly
- [ ] No Python errors in console
- [ ] No JavaScript errors in browser console

---

## Development Workflow

### Making Changes

1. **Edit code** in tank_server.py or game.js
2. **Restart server** (required for server changes)
   ```bash
   pkill -f "python tank_server.py"
   python tank_server.py
   ```
3. **Refresh browser** (Ctrl+Shift+R or Cmd+Shift+R)
4. **Test changes** in-game
5. **Check console logs** (server and browser)

### Git Workflow (if using version control)

```bash
# Create feature branch
git checkout -b feature/new-powerup

# Make changes and commit
git add .
git commit -m "Add new super speed powerup"

# Test thoroughly
python tank_server.py
# Play test...

# Merge to main
git checkout main
git merge feature/new-powerup
git push
```

### Testing New Features

1. **Unit test** - Test function in isolation
2. **Integration test** - Test with game loop
3. **Solo test** - Play alone with bots
4. **Multiplayer test** - Test with 2+ players
5. **Stress test** - Test with 10+ players

---

## Quick Reference

### Important URLs
- **Game**: http://localhost:8051
- **Source**: /Users/minhtrung.le/vietlinks/Note_task/GAME/tank_battle/

### Key Commands
```bash
# Start server
python tank_server.py

# Start on custom port
python tank_server.py 8052

# Kill server
pkill -f "python tank_server.py"

# Check if running
ps aux | grep tank_server.py
```

### Key Shortcuts (In-game)
- **WASD** - Move tank
- **Mouse** - Aim turret
- **Click / Space** - Shoot
- **C** - Activate ultimate skill

### Debug Mode

Add this to tank_server.py for verbose logging:
```python
DEBUG = True

def debug_log(message):
    if DEBUG:
        print(f'[DEBUG] {message}')

# Use throughout code
debug_log(f'Player {player_id} shot bullet at angle {angle}')
```

---

## Version History

### v2.1 (Current) - April 2026
- ✅ Fixed terrain overlap
- ✅ Added in-game map selection
- ✅ Fixed firing direction accuracy
- ✅ Added snake HP system (2000 HP)
- ✅ Added laser beam snake damage (100 HP / 0.5s)
- ✅ Added AI bot system (auto-spawn for solo play)
- ✅ Adjusted skill durations (Laser: 3s, Speed: 4s, Ghost: 5s)
- ✅ Reduced map density (Basic: 1-2 walls, Advanced: 3-4, Maze: 7-8)
- ✅ Fixed canvas visibility (reduced height to 840px)

### v2.0 - Enhanced Gameplay
- Added ultimate skills system (3 skills)
- Added snake enemy system
- Added shield power-up
- Added player customization

### v1.0 - Initial Release
- Basic multiplayer gameplay
- Three map types
- Power-up system
- Kill/death tracking

---

## Resources

### Documentation
- Flask-SocketIO: https://flask-socketio.readthedocs.io/
- Socket.IO: https://socket.io/docs/v4/
- HTML5 Canvas: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API

### Game Design References
- 2D Collision Detection: https://developer.mozilla.org/en-US/docs/Games/Techniques/2D_collision_detection
- Game Loop Patterns: https://gameprogrammingpatterns.com/game-loop.html

### Python Libraries
```bash
pip install flask flask-socketio flask-cors gevent gevent-websocket
```

---

## Contact & Support

For questions or issues:
1. Check this documentation
2. Check TEST_LASER_SNAKE.md for testing guides
3. Check FIXES_SUMMARY.md for recent changes
4. Check server console for error messages
5. Check browser console (F12) for client errors

---

**Last Updated**: April 2026 (v2.1)
**Maintainer**: TrungLe
**Port**: 8051 (default)
