#!/usr/bin/env python3
"""
Multiplayer Tank Battle Game Server
A real-time multiplayer tank battle game using Flask-SocketIO
"""

# IMPORTANT: gevent monkey patch must be called FIRST before any other imports
from gevent import monkey
monkey.patch_all()

# Now import everything else
import random
import time
import math
import logging
from typing import Dict, List, Tuple
from flask import Flask, render_template, send_from_directory, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS

# Configure logging to suppress noisy errors
logging.basicConfig(level=logging.WARNING)
logging.getLogger('werkzeug').setLevel(logging.ERROR)
logging.getLogger('gevent').setLevel(logging.ERROR)

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = 'tank_battle_secret_key_2024'

# Enable CORS for all routes and origins
CORS(app, resources={r"/*": {"origins": "*"}})

# Configure SocketIO with CORS enabled
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='gevent',
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    transports=['websocket', 'polling']
)

# Error handlers
@app.errorhandler(400)
def bad_request(error):
    """Handle bad requests"""
    return "Bad Request", 400

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle general exceptions to prevent crashes"""
    import traceback
    error_msg = str(e)
    if 'Invalid HTTP method' not in error_msg:
        print(f'✗ Server error: {error_msg}')
        traceback.print_exc()
    return "Internal Server Error", 500

# Game constants
ARENA_WIDTH = 1440
ARENA_HEIGHT = 840  # Reduced to fit with header/footer
GAME_TICK_RATE = 30  # Updates per second
TANK_SIZE = 30
TANK_SPEED = 5.0  # Base tank speed
TANK_ROTATION_SPEED = 0.1
TANK_MAX_HEALTH = 100
BULLET_SPEED = 9.2  # Increased by 15%
BULLET_SIZE = 6
BULLET_DAMAGE = 25
BULLET_LIFETIME = 115  # Increased by 15%
SHOOT_COOLDOWN = 15  # ticks (0.5 seconds at 30 ticks/sec)
RESPAWN_TIME = 5  # seconds

# Map type (can be changed: 'basic', 'advanced', 'maze')
MAP_TYPE = 'advanced'  # Default map type
current_map_type = 'advanced'  # Currently active map
map_votes: Dict[str, str] = {}  # Player votes for map type

# Game Mode
GAME_MODE_FFA = 'ffa'           # Free-for-All
GAME_MODE_DUEL = 'duel'         # Team Duel
current_game_mode = GAME_MODE_FFA  # Currently active game mode
game_mode_votes: Dict[str, str] = {}  # Player votes for game mode

# Duel Mode Constants
DUEL_MAX_TEAM_SIZE = 5          # Maximum 5 players per team
DUEL_WIN_KILLS = 50             # 50 kills = 50,000 points to win
DUEL_BASE_HEALTH = 1000         # Core base health
DUEL_BASE_SIZE = 80             # Size of base visual

# Game state
players: Dict[str, dict] = {}
bullets: List[dict] = []
terrain: List[dict] = []
supply_drops: List[dict] = []  # Current supply drops on map (up to 2)
last_supply_drop_time: float = 0  # Last time supply drops spawned
last_super_drop_time: float = 0  # Last time super drop spawned
snake: dict = None  # Current snake on screen (None if no snake active)
last_snake_time: float = 0  # Last time snake spawned
shield_drop: dict = None  # Current shield drop on map (None if no shield active)
last_shield_drop_time: float = 0  # Last time shield drop spawned
atomic_bomb: dict = None  # Current atomic bomb on map (None if no bomb active)
last_atomic_bomb_time: float = 0  # Last time atomic bomb spawned
current_captain_id: str = None  # ID of current captain (None if no captain)
last_captain_time: float = 0  # Last time captain was selected
game_running = False
terrain_generated = False

# Duel Mode State
team_red_kills = 0              # Red team total kills
team_blue_kills = 0             # Blue team total kills
red_base: dict = None           # Red team base
blue_base: dict = None          # Blue team base
game_winner: str = None         # 'red', 'blue', or None

# Bot system
bots: Dict[str, dict] = {}  # AI-controlled tanks
bot_counter = 0  # Counter for bot IDs
BOT_MOVE_CHANGE_INTERVAL = 60  # ticks between direction changes (2 seconds)
BOT_SHOOT_INTERVAL = 45  # ticks between shots (1.5 seconds)

# Power-up constants
SUPPLY_DROP_INTERVAL = 10  # seconds between supply drops
SUPPLY_DROP_SIZE = 30  # Size of supply drop visual
POWERUP_DURATION = 10  # seconds power-up lasts
FAST_FIRE_COOLDOWN = 3  # ticks (0.1s at 30 ticks/sec = 10 shots/sec)
FAN_SHOT_BULLETS = 3  # Number of bullets in fan shot
FAN_SHOT_SPREAD = 0.4  # Radians spread for fan shot
SPEED_BOOST_MULTIPLIER = 2.0  # 100% increase = 2x speed
SUPER_DROP_INTERVAL = 60  # seconds between super drops
SUPER_POWERUP_DURATION = 6  # seconds super power-up lasts

# Snake constants
SNAKE_INTERVAL = 30  # seconds between snake spawns
SNAKE_CELL_SIZE = 30  # Size of one cell (same as tank size)
SNAKE_WIDTH_CELLS = 3  # Width in cells
SNAKE_LENGTH_CELLS = 26  # Length in cells
SNAKE_WIDTH = SNAKE_CELL_SIZE * SNAKE_WIDTH_CELLS  # 90 pixels wide
SNAKE_LENGTH = SNAKE_CELL_SIZE * SNAKE_LENGTH_CELLS  # 390 pixels long
SNAKE_SPEED = 15  # Speed of snake movement

# Shield power-up constants
SHIELD_DROP_INTERVAL = 10  # seconds between shield drops
SHIELD_DURATION = 6  # seconds shield lasts

# Atomic Bomb constants
ATOMIC_BOMB_INTERVAL = 60  # seconds between atomic bomb spawns
ATOMIC_BOMB_SIZE = 40  # Size of atomic bomb visual
ATOMIC_BOMB_PREPARATION = 3.0  # seconds preparation phase (warning, frozen in place)
ATOMIC_BOMB_FREEZE = 2.0  # seconds post-detonation frozen phase

# Captain System constants
CAPTAIN_INTERVAL = 60  # seconds between captain selections (NOT USED - captain selected immediately on death)
CAPTAIN_SPEED_MULTIPLIER = 1.5  # 50% speed increase
CAPTAIN_FIRE_RATE_MULTIPLIER = 1.5  # 50% faster firing (cooldown reduced by 33%)
CAPTAIN_KILL_REWARD = 1000  # Points for killing the captain
CAPTAIN_TARGET_INTERVAL = 30     # Seconds between "target the captain" pulses
CAPTAIN_TARGET_DURATION = 5.0    # Seconds the targeting visual stays on the captain

# Ricochet System constants
RICOCHET_SCORE_1 = 500  # Score needed for 1 ricochet
RICOCHET_SCORE_2 = 1000  # Score needed for 2 ricochets

# Emoji display (Press T to cycle)
EMOJI_LIST = [
    '😁',  # Happy
    '😢',  # Sad
    '😡',  # Angry
    '😲',  # Surprised
    '🤣',  # Laughing hard
    '🙈',  # Embarrassed
    '😍',  # Love / adore
    '😫',  # Tired
    '🤔',  # Thinking
    '😏',  # Cool / confident
]
EMOJI_DISPLAY_DURATION = 5.0  # seconds an emoji stays visible above the tank

# Ultimate Skill constants
SKILL_COOLDOWN = 30  # seconds cooldown (starts after skill ends)
SKILL_SPEED_DEMON_DURATION = 4  # seconds
SKILL_SPEED_DEMON_SPEED_MULT = 5.0  # 400% increase = 5x speed
SKILL_SPEED_DEMON_DAMAGE_BONUS = 100  # +100 damage per bullet
SKILL_LASER_BEAM_PREPARATION = 1.0  # seconds preparation phase (warning, frozen in place)
SKILL_LASER_BEAM_DURATION = 0.5  # seconds firing phase
SKILL_LASER_BEAM_COOLDOWN = 1.0  # seconds post-firing frozen phase
SKILL_LASER_RANGE = 800  # Laser reach distance
SKILL_GHOST_MODE_DURATION = 5  # seconds

# Colors for different players
TANK_COLORS = [
    '#32CD32',  # Lime green
    '#FF4500',  # Orange red
    '#1E90FF',  # Dodger blue
    '#FFD700',  # Gold
    '#FF1493',  # Deep pink
    '#00CED1',  # Dark turquoise
    '#FF6347',  # Tomato
    '#9370DB',  # Medium purple
    '#00FA9A',  # Medium spring green
    '#FF8C00',  # Dark orange
]


def check_terrain_overlap(x: float, y: float, width: float, height: float, margin: float = 10) -> bool:
    """Check if a new terrain object would overlap with existing terrain"""
    for obj in terrain:
        # Add margin for spacing between objects
        if (x - margin < obj['x'] + obj['width'] + margin and
            x + width + margin > obj['x'] - margin and
            y - margin < obj['y'] + obj['height'] + margin and
            y + height + margin > obj['y'] - margin):
            return True
    return False


def generate_terrain_basic():
    """Generate basic map - 1-2 walls and 1-2 bushes (Very Simple)"""
    global terrain
    terrain = []

    # Generate 1-2 scattered bar-shaped ramparts with spacing
    num_bars = random.randint(1, 2)
    walls_placed = 0
    attempts = 0
    max_attempts = num_bars * 50  # Increased to ensure target count

    # Minimum gap: 2-3 cells (60-90 pixels) for tanks to pass through
    wall_spacing = random.randint(60, 90)

    while walls_placed < num_bars and attempts < max_attempts:
        orientation = random.choice(['horizontal', 'vertical'])
        if orientation == 'horizontal':
            width = random.randint(150, 300)
            height = random.randint(20, 35)
        else:
            width = random.randint(20, 35)
            height = random.randint(150, 300)

        x = random.randint(100, ARENA_WIDTH - 100 - width)
        y = random.randint(100, ARENA_HEIGHT - 100 - height)

        # Check if this wall overlaps with existing walls (with spacing margin)
        if not check_terrain_overlap(x, y, width, height, margin=wall_spacing):
            terrain.append({
                'type': 'rampart',
                'x': x,
                'y': y,
                'width': width,
                'height': height
            })
            walls_placed += 1

        attempts += 1

    # Generate 1-2 bushes - avoid overlapping with walls
    num_bushes = random.randint(1, 2)
    bushes_placed = 0
    attempts = 0
    max_attempts = num_bushes * 20

    while bushes_placed < num_bushes and attempts < max_attempts:
        size = random.randint(60, 100)
        x = random.randint(50, ARENA_WIDTH - 50 - size)
        y = random.randint(50, ARENA_HEIGHT - 50 - size)

        # Check if this bush would overlap with existing terrain
        if not check_terrain_overlap(x, y, size, size):
            terrain.append({
                'type': 'bush',
                'x': x,
                'y': y,
                'width': size,
                'height': size
            })
            bushes_placed += 1

        attempts += 1


def generate_terrain_advanced():
    """Generate advanced map - 3-4 walls and 2-3 bushes (Medium Complexity)"""
    global terrain
    terrain = []

    # Generate 3-4 scattered bar-shaped ramparts with mix of sizes and spacing
    num_bars = random.randint(3, 4)
    walls_placed = 0
    attempts = 0
    max_attempts = num_bars * 80  # Increased to ensure target count

    # Minimum gap: 2-3 cells (60-90 pixels) for tanks to pass through
    wall_spacing = random.randint(60, 90)

    while walls_placed < num_bars and attempts < max_attempts:
        orientation = random.choice(['horizontal', 'vertical'])

        # Some walls are longer, some shorter for variety
        if walls_placed < num_bars // 3:
            # Long walls
            if orientation == 'horizontal':
                width = random.randint(200, 400)
                height = random.randint(20, 30)
            else:
                width = random.randint(20, 30)
                height = random.randint(200, 400)
        else:
            # Medium walls
            if orientation == 'horizontal':
                width = random.randint(100, 200)
                height = random.randint(20, 30)
            else:
                width = random.randint(20, 30)
                height = random.randint(100, 200)

        x = random.randint(80, ARENA_WIDTH - 80 - width)
        y = random.randint(80, ARENA_HEIGHT - 80 - height)

        # Check if this wall overlaps with existing walls (with spacing margin)
        if not check_terrain_overlap(x, y, width, height, margin=wall_spacing):
            terrain.append({
                'type': 'rampart',
                'x': x,
                'y': y,
                'width': width,
                'height': height
            })
            walls_placed += 1

        attempts += 1

    # Generate 2-3 bushes - avoid overlapping with walls
    num_bushes = random.randint(2, 3)
    bushes_placed = 0
    attempts = 0
    max_attempts = num_bushes * 20

    while bushes_placed < num_bushes and attempts < max_attempts:
        size = random.randint(60, 100)
        x = random.randint(50, ARENA_WIDTH - 50 - size)
        y = random.randint(50, ARENA_HEIGHT - 50 - size)

        # Check if this bush would overlap with existing terrain
        if not check_terrain_overlap(x, y, size, size):
            terrain.append({
                'type': 'bush',
                'x': x,
                'y': y,
                'width': size,
                'height': size
            })
            bushes_placed += 1

        attempts += 1


def generate_terrain_maze():
    """Generate maze map - 7-8 walls and 4-5 bushes (Complex)"""
    global terrain
    terrain = []

    # Generate 7-8 walls with varied sizes for maze-like complexity with spacing
    num_bars = random.randint(7, 8)
    walls_placed = 0
    attempts = 0
    max_attempts = num_bars * 100  # Increased from 30 to 100 for complex maps

    # Minimum gap: 2 cells (60 pixels) for tanks to pass through - reduced spacing for maze density
    wall_spacing = 60

    while walls_placed < num_bars and attempts < max_attempts:
        orientation = random.choice(['horizontal', 'vertical'])

        # Mix of different wall lengths for maze effect
        wall_type = walls_placed % 3

        if wall_type == 0:
            # Long walls
            if orientation == 'horizontal':
                width = random.randint(250, 450)
                height = random.randint(20, 30)
            else:
                width = random.randint(20, 30)
                height = random.randint(250, 450)
        elif wall_type == 1:
            # Medium walls
            if orientation == 'horizontal':
                width = random.randint(120, 250)
                height = random.randint(20, 30)
            else:
                width = random.randint(20, 30)
                height = random.randint(120, 250)
        else:
            # Short walls for tight spaces
            if orientation == 'horizontal':
                width = random.randint(60, 120)
                height = random.randint(20, 30)
            else:
                width = random.randint(20, 30)
                height = random.randint(60, 120)

        x = random.randint(60, ARENA_WIDTH - 60 - width)
        y = random.randint(60, ARENA_HEIGHT - 60 - height)

        # Check if this wall overlaps with existing walls (with spacing margin)
        if not check_terrain_overlap(x, y, width, height, margin=wall_spacing):
            terrain.append({
                'type': 'rampart',
                'x': x,
                'y': y,
                'width': width,
                'height': height
            })
            walls_placed += 1

        attempts += 1

    # Generate 4-5 bushes - avoid overlapping with walls
    num_bushes = random.randint(4, 5)
    bushes_placed = 0
    attempts = 0
    max_attempts = num_bushes * 20

    while bushes_placed < num_bushes and attempts < max_attempts:
        size = random.randint(50, 90)
        x = random.randint(50, ARENA_WIDTH - 50 - size)
        y = random.randint(50, ARENA_HEIGHT - 50 - size)

        # Check if this bush would overlap with existing terrain
        if not check_terrain_overlap(x, y, size, size):
            terrain.append({
                'type': 'bush',
                'x': x,
                'y': y,
                'width': size,
                'height': size
            })
            bushes_placed += 1

        attempts += 1


def generate_terrain_duel_simple():
    """SIMPLE MAP (BASIC): Clean 3-lane structure with minimal obstacles"""
    global terrain, red_base, blue_base

    terrain = []

    # BOUNDARY WALLS
    wall_thickness = 20

    # Top boundary
    terrain.append({'type': 'rampart', 'x': 0, 'y': 0, 'width': ARENA_WIDTH, 'height': wall_thickness})

    # Bottom boundary
    terrain.append({'type': 'rampart', 'x': 0, 'y': ARENA_HEIGHT - wall_thickness, 'width': ARENA_WIDTH, 'height': wall_thickness})

    base_gap_size = DUEL_BASE_SIZE + 40
    base_center_y = ARENA_HEIGHT / 2

    # Left boundary (with gap)
    terrain.append({'type': 'rampart', 'x': 0, 'y': wall_thickness, 'width': wall_thickness, 'height': base_center_y - base_gap_size / 2 - wall_thickness})
    terrain.append({'type': 'rampart', 'x': 0, 'y': base_center_y + base_gap_size / 2, 'width': wall_thickness, 'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness})

    # Right boundary (with gap)
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH - wall_thickness, 'y': wall_thickness, 'width': wall_thickness, 'height': base_center_y - base_gap_size / 2 - wall_thickness})
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH - wall_thickness, 'y': base_center_y + base_gap_size / 2, 'width': wall_thickness, 'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness})

    # 3 LANES - Simple dividing walls
    # Horizontal dividers creating lanes
    lane_divider_height = 20
    lane_divider_width = ARENA_WIDTH * 0.6  # Don't reach edges

    # Top lane divider
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH * 0.2, 'y': ARENA_HEIGHT / 3 - lane_divider_height / 2, 'width': lane_divider_width, 'height': lane_divider_height})

    # Bottom lane divider
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH * 0.2, 'y': 2 * ARENA_HEIGHT / 3 - lane_divider_height / 2, 'width': lane_divider_width, 'height': lane_divider_height})

    # Minimal bushes in lanes for cover
    bush_positions = [
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 6),     # Top lane
        (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 6),
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 2),     # Mid lane
        (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 2),
        (ARENA_WIDTH / 4, 5 * ARENA_HEIGHT / 6), # Bot lane
        (3 * ARENA_WIDTH / 4, 5 * ARENA_HEIGHT / 6),
    ]

    for bush_x, bush_y in bush_positions:
        terrain.append({'type': 'bush', 'x': bush_x - 35, 'y': bush_y - 35, 'width': 70, 'height': 70})

    # Team bases
    red_base = {'team': 'red', 'x': 30, 'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2, 'width': DUEL_BASE_SIZE, 'height': DUEL_BASE_SIZE, 'health': DUEL_BASE_HEALTH, 'max_health': DUEL_BASE_HEALTH}
    blue_base = {'team': 'blue', 'x': ARENA_WIDTH - 30 - DUEL_BASE_SIZE, 'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2, 'width': DUEL_BASE_SIZE, 'height': DUEL_BASE_SIZE, 'health': DUEL_BASE_HEALTH, 'max_health': DUEL_BASE_HEALTH}

    # Base protection walls
    terrain.append({'type': 'rampart', 'x': 0, 'y': red_base['y'] - 20, 'width': red_base['x'] + 10, 'height': 20})
    terrain.append({'type': 'rampart', 'x': 0, 'y': red_base['y'] + red_base['height'], 'width': red_base['x'] + 10, 'height': 20})
    terrain.append({'type': 'rampart', 'x': blue_base['x'] + blue_base['width'] - 10, 'y': blue_base['y'] - 20, 'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10), 'height': 20})
    terrain.append({'type': 'rampart', 'x': blue_base['x'] + blue_base['width'] - 10, 'y': blue_base['y'] + blue_base['height'], 'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10), 'height': 20})

    # Center barrier wall - 6 cells long (180px) to block direct line of sight between bases
    barrier_length = 180  # 6 cells × 30px
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH / 2 - barrier_length / 2, 'y': ARENA_HEIGHT / 2 - 15, 'width': barrier_length, 'height': 30})

    print(f'🏰 Generated SIMPLE DUEL map: 3 clean lanes, 6 bushes, 6-cell center barrier, base protection')


def generate_terrain_duel_river():
    """MAZE MAP: 3 lanes + river crossing with bridges"""
    global terrain, red_base, blue_base

    terrain = []

    # BOUNDARY WALLS
    wall_thickness = 20
    terrain.append({'type': 'rampart', 'x': 0, 'y': 0, 'width': ARENA_WIDTH, 'height': wall_thickness})
    terrain.append({'type': 'rampart', 'x': 0, 'y': ARENA_HEIGHT - wall_thickness, 'width': ARENA_WIDTH, 'height': wall_thickness})

    base_gap_size = DUEL_BASE_SIZE + 40
    base_center_y = ARENA_HEIGHT / 2
    terrain.append({'type': 'rampart', 'x': 0, 'y': wall_thickness, 'width': wall_thickness, 'height': base_center_y - base_gap_size / 2 - wall_thickness})
    terrain.append({'type': 'rampart', 'x': 0, 'y': base_center_y + base_gap_size / 2, 'width': wall_thickness, 'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness})
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH - wall_thickness, 'y': wall_thickness, 'width': wall_thickness, 'height': base_center_y - base_gap_size / 2 - wall_thickness})
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH - wall_thickness, 'y': base_center_y + base_gap_size / 2, 'width': wall_thickness, 'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness})

    # RIVER - Vertical "water" barrier with 3 bridge crossings (one per lane)
    river_width = 60
    river_x = ARENA_WIDTH / 2 - river_width / 2

    # Top bridge (top lane)
    terrain.append({'type': 'rampart', 'x': river_x, 'y': wall_thickness + 20, 'width': river_width, 'height': ARENA_HEIGHT / 6 - 60})

    # Between top and mid bridge
    terrain.append({'type': 'rampart', 'x': river_x, 'y': ARENA_HEIGHT / 6 + 60, 'width': river_width, 'height': ARENA_HEIGHT / 3 - 180})

    # Between mid and bot bridge
    terrain.append({'type': 'rampart', 'x': river_x, 'y': ARENA_HEIGHT / 2 + 60, 'width': river_width, 'height': ARENA_HEIGHT / 3 - 180})

    # Bottom section
    terrain.append({'type': 'rampart', 'x': river_x, 'y': 5 * ARENA_HEIGHT / 6 + 60, 'width': river_width, 'height': ARENA_HEIGHT / 6 - 80})

    # Extra walls near bridges for choke points
    for bridge_y in [ARENA_HEIGHT / 6, ARENA_HEIGHT / 2, 5 * ARENA_HEIGHT / 6]:
        terrain.append({'type': 'rampart', 'x': ARENA_WIDTH / 4, 'y': bridge_y - 40, 'width': 80, 'height': 20})
        terrain.append({'type': 'rampart', 'x': 3 * ARENA_WIDTH / 4 - 80, 'y': bridge_y - 40, 'width': 80, 'height': 20})

    # Dense bushes near river for ambush spots
    bush_positions = [
        (ARENA_WIDTH / 3, ARENA_HEIGHT / 6), (2 * ARENA_WIDTH / 3, ARENA_HEIGHT / 6),
        (ARENA_WIDTH / 3, ARENA_HEIGHT / 2), (2 * ARENA_WIDTH / 3, ARENA_HEIGHT / 2),
        (ARENA_WIDTH / 3, 5 * ARENA_HEIGHT / 6), (2 * ARENA_WIDTH / 3, 5 * ARENA_HEIGHT / 6),
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 3), (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 3),
        (ARENA_WIDTH / 4, 2 * ARENA_HEIGHT / 3), (3 * ARENA_WIDTH / 4, 2 * ARENA_HEIGHT / 3),
    ]

    for bush_x, bush_y in bush_positions:
        terrain.append({'type': 'bush', 'x': bush_x - 35, 'y': bush_y - 35, 'width': 70, 'height': 70})

    # Team bases
    red_base = {'team': 'red', 'x': 30, 'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2, 'width': DUEL_BASE_SIZE, 'height': DUEL_BASE_SIZE, 'health': DUEL_BASE_HEALTH, 'max_health': DUEL_BASE_HEALTH}
    blue_base = {'team': 'blue', 'x': ARENA_WIDTH - 30 - DUEL_BASE_SIZE, 'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2, 'width': DUEL_BASE_SIZE, 'height': DUEL_BASE_SIZE, 'health': DUEL_BASE_HEALTH, 'max_health': DUEL_BASE_HEALTH}

    # Base protection
    terrain.append({'type': 'rampart', 'x': 0, 'y': red_base['y'] - 20, 'width': red_base['x'] + 10, 'height': 20})
    terrain.append({'type': 'rampart', 'x': 0, 'y': red_base['y'] + red_base['height'], 'width': red_base['x'] + 10, 'height': 20})
    terrain.append({'type': 'rampart', 'x': blue_base['x'] + blue_base['width'] - 10, 'y': blue_base['y'] - 20, 'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10), 'height': 20})
    terrain.append({'type': 'rampart', 'x': blue_base['x'] + blue_base['width'] - 10, 'y': blue_base['y'] + blue_base['height'], 'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10), 'height': 20})

    # Center barrier wall - 6 cells long (180px) to block direct line of sight between bases
    barrier_length = 180  # 6 cells × 30px
    terrain.append({'type': 'rampart', 'x': ARENA_WIDTH / 2 - barrier_length / 2, 'y': ARENA_HEIGHT / 2 - 15, 'width': barrier_length, 'height': 30})

    print(f'🏰 Generated RIVER DUEL map: 3 lanes with river + 3 bridges, 10 bushes, 6-cell center barrier, choke points')


def generate_terrain_duel_jungle():
    """ADVANCED MAP: 3 lanes + jungle camps (more walls and bushes for jungle areas)"""
    global terrain, red_base, blue_base

    terrain = []

    # BOUNDARY WALLS (Closed rectangle - players cannot cross)
    wall_thickness = 20

    # Top boundary wall
    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': 0,
        'width': ARENA_WIDTH,
        'height': wall_thickness
    })

    # Bottom boundary wall
    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': ARENA_HEIGHT - wall_thickness,
        'width': ARENA_WIDTH,
        'height': wall_thickness
    })

    # Left boundary wall (with gap for Red base)
    base_gap_size = DUEL_BASE_SIZE + 40
    base_center_y = ARENA_HEIGHT / 2

    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': wall_thickness,
        'width': wall_thickness,
        'height': base_center_y - base_gap_size / 2 - wall_thickness
    })

    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': base_center_y + base_gap_size / 2,
        'width': wall_thickness,
        'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness
    })

    # Right boundary wall (with gap for Blue base)
    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH - wall_thickness,
        'y': wall_thickness,
        'width': wall_thickness,
        'height': base_center_y - base_gap_size / 2 - wall_thickness
    })

    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH - wall_thickness,
        'y': base_center_y + base_gap_size / 2,
        'width': wall_thickness,
        'height': ARENA_HEIGHT - base_center_y - base_gap_size / 2 - wall_thickness
    })

    # MANDATORY FIXED PATHS - 3 lanes (top, middle, bottom)
    # These create a lane-based map structure

    # Center vertical wall with gaps for 3 paths
    center_x = ARENA_WIDTH / 2 - 15
    path_width = 120

    # Top section of center wall
    terrain.append({
        'type': 'rampart',
        'x': center_x,
        'y': wall_thickness + 20,
        'width': 30,
        'height': ARENA_HEIGHT / 4 - path_width / 2 - wall_thickness - 20
    })

    # Middle-top section
    terrain.append({
        'type': 'rampart',
        'x': center_x,
        'y': ARENA_HEIGHT / 4 + path_width / 2,
        'width': 30,
        'height': ARENA_HEIGHT / 4 - path_width
    })

    # Middle-bottom section
    terrain.append({
        'type': 'rampart',
        'x': center_x,
        'y': 3 * ARENA_HEIGHT / 4 + path_width / 2,
        'width': 30,
        'height': ARENA_HEIGHT / 4 - path_width / 2 - wall_thickness - 20
    })

    # COMPLEX WALL STRUCTURES - Symmetrical on both sides

    # Quarter-line vertical walls on each side (with gaps)
    left_quarter_x = ARENA_WIDTH / 4 - 15
    right_quarter_x = 3 * ARENA_WIDTH / 4 - 15

    # Left side walls
    terrain.append({
        'type': 'rampart',
        'x': left_quarter_x,
        'y': wall_thickness + 80,
        'width': 30,
        'height': 180
    })

    terrain.append({
        'type': 'rampart',
        'x': left_quarter_x,
        'y': ARENA_HEIGHT - wall_thickness - 260,
        'width': 30,
        'height': 180
    })

    # Right side walls (symmetrical)
    terrain.append({
        'type': 'rampart',
        'x': right_quarter_x,
        'y': wall_thickness + 80,
        'width': 30,
        'height': 180
    })

    terrain.append({
        'type': 'rampart',
        'x': right_quarter_x,
        'y': ARENA_HEIGHT - wall_thickness - 260,
        'width': 30,
        'height': 180
    })

    # Horizontal walls creating choke points
    # Top lane walls
    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH / 6,
        'y': ARENA_HEIGHT / 4 - 15,
        'width': 120,
        'height': 30
    })

    terrain.append({
        'type': 'rampart',
        'x': 5 * ARENA_WIDTH / 6 - 120,
        'y': ARENA_HEIGHT / 4 - 15,
        'width': 120,
        'height': 30
    })

    # Bottom lane walls
    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH / 6,
        'y': 3 * ARENA_HEIGHT / 4 - 15,
        'width': 120,
        'height': 30
    })

    terrain.append({
        'type': 'rampart',
        'x': 5 * ARENA_WIDTH / 6 - 120,
        'y': 3 * ARENA_HEIGHT / 4 - 15,
        'width': 120,
        'height': 30
    })

    # Additional tactical walls near bases
    # Red side (left)
    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH / 8,
        'y': ARENA_HEIGHT / 3 - 60,
        'width': 100,
        'height': 30
    })

    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH / 8,
        'y': 2 * ARENA_HEIGHT / 3 + 30,
        'width': 100,
        'height': 30
    })

    # Blue side (right) - symmetrical
    terrain.append({
        'type': 'rampart',
        'x': 7 * ARENA_WIDTH / 8 - 100,
        'y': ARENA_HEIGHT / 3 - 60,
        'width': 100,
        'height': 30
    })

    terrain.append({
        'type': 'rampart',
        'x': 7 * ARENA_WIDTH / 8 - 100,
        'y': 2 * ARENA_HEIGHT / 3 + 30,
        'width': 100,
        'height': 30
    })

    # BUSHES - More strategic placement for cover in lanes
    bush_positions = [
        # Top lane bushes
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 4 - 80),
        (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 4 - 80),
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 4 + 80),
        (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 4 + 80),

        # Middle lane bushes
        (ARENA_WIDTH / 4, ARENA_HEIGHT / 2),
        (3 * ARENA_WIDTH / 4, ARENA_HEIGHT / 2),
        (ARENA_WIDTH / 3, ARENA_HEIGHT / 2 - 60),
        (2 * ARENA_WIDTH / 3, ARENA_HEIGHT / 2 - 60),
        (ARENA_WIDTH / 3, ARENA_HEIGHT / 2 + 60),
        (2 * ARENA_WIDTH / 3, ARENA_HEIGHT / 2 + 60),

        # Bottom lane bushes
        (ARENA_WIDTH / 4, 3 * ARENA_HEIGHT / 4 - 80),
        (3 * ARENA_WIDTH / 4, 3 * ARENA_HEIGHT / 4 - 80),
        (ARENA_WIDTH / 4, 3 * ARENA_HEIGHT / 4 + 80),
        (3 * ARENA_WIDTH / 4, 3 * ARENA_HEIGHT / 4 + 80),

        # Base approach bushes
        (ARENA_WIDTH / 6, ARENA_HEIGHT / 2 - 100),
        (5 * ARENA_WIDTH / 6, ARENA_HEIGHT / 2 - 100),
        (ARENA_WIDTH / 6, ARENA_HEIGHT / 2 + 100),
        (5 * ARENA_WIDTH / 6, ARENA_HEIGHT / 2 + 100),
    ]

    for bush_x, bush_y in bush_positions:
        terrain.append({
            'type': 'bush',
            'x': bush_x - 35,
            'y': bush_y - 35,
            'width': 70,
            'height': 70
        })

    # Create team bases (at the innermost edge of each side, behind boundary walls)
    red_base = {
        'team': 'red',
        'x': 30,  # Just inside left boundary
        'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2,
        'width': DUEL_BASE_SIZE,
        'height': DUEL_BASE_SIZE,
        'health': DUEL_BASE_HEALTH,
        'max_health': DUEL_BASE_HEALTH
    }

    blue_base = {
        'team': 'blue',
        'x': ARENA_WIDTH - 30 - DUEL_BASE_SIZE,  # Just inside right boundary
        'y': ARENA_HEIGHT / 2 - DUEL_BASE_SIZE / 2,
        'width': DUEL_BASE_SIZE,
        'height': DUEL_BASE_SIZE,
        'health': DUEL_BASE_HEALTH,
        'max_health': DUEL_BASE_HEALTH
    }

    # BLOCK BACK EDGE PENETRATION - Add walls behind core buildings
    # These prevent players from going around the back of enemy base

    # Red base back wall (left edge)
    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': red_base['y'] - 20,
        'width': red_base['x'] + 10,
        'height': 20
    })
    terrain.append({
        'type': 'rampart',
        'x': 0,
        'y': red_base['y'] + red_base['height'],
        'width': red_base['x'] + 10,
        'height': 20
    })

    # Blue base back wall (right edge)
    terrain.append({
        'type': 'rampart',
        'x': blue_base['x'] + blue_base['width'] - 10,
        'y': blue_base['y'] - 20,
        'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10),
        'height': 20
    })
    terrain.append({
        'type': 'rampart',
        'x': blue_base['x'] + blue_base['width'] - 10,
        'y': blue_base['y'] + blue_base['height'],
        'width': ARENA_WIDTH - (blue_base['x'] + blue_base['width'] - 10),
        'height': 20
    })

    # BARRIER WALL BETWEEN BASES - 6 cells long (180px) to block direct line of sight
    barrier_length = 180  # 6 cells × 30px
    terrain.append({
        'type': 'rampart',
        'x': ARENA_WIDTH / 2 - barrier_length / 2,
        'y': ARENA_HEIGHT / 2 - 15,
        'width': barrier_length,
        'height': 30
    })

    print(f'🏰 Generated JUNGLE DUEL map: {len(terrain)} objects (boundaries + walls + bushes + base protection), 2 team bases')
    print(f'   Red Base: ({red_base["x"]}, {red_base["y"]})')
    print(f'   Blue Base: ({blue_base["x"]}, {blue_base["y"]})')
    print(f'   Map features: Closed boundaries, 3-lane structure, 18 bushes, jungle camps, 6-cell center barrier')


def get_winning_map_vote() -> str:
    """Determine the winning map type based on player votes"""
    if not map_votes:
        return MAP_TYPE  # Default if no votes

    # Count votes
    vote_counts = {}
    for vote in map_votes.values():
        vote_counts[vote] = vote_counts.get(vote, 0) + 1

    # Return map with most votes
    winning_map = max(vote_counts.items(), key=lambda x: x[1])[0]
    return winning_map


def get_winning_game_mode_vote() -> str:
    """Determine the winning game mode based on player votes"""
    if not game_mode_votes:
        return GAME_MODE_FFA  # Default if no votes

    # Count votes
    vote_counts = {}
    for vote in game_mode_votes.values():
        vote_counts[vote] = vote_counts.get(vote, 0) + 1

    # Return mode with most votes
    winning_mode = max(vote_counts.items(), key=lambda x: x[1])[0]
    return winning_mode


def generate_terrain(map_type: str = None, game_mode: str = None):
    """Generate terrain based on selected map type and game mode"""
    global current_map_type, current_game_mode, terrain_generated

    if game_mode is None:
        game_mode = get_winning_game_mode_vote()

    current_game_mode = game_mode

    # Get map type for both modes
    if map_type is None:
        map_type = get_winning_map_vote()

    current_map_type = map_type

    # Duel mode uses MOBA-style maps (3 lanes + jungle + river)
    if game_mode == GAME_MODE_DUEL:
        if map_type == 'basic':
            generate_terrain_duel_simple()  # Simple 3-lane map
        elif map_type == 'advanced':
            generate_terrain_duel_jungle()  # 3 lanes + jungle camps
        elif map_type == 'maze':
            generate_terrain_duel_river()  # 3 lanes + river crossing
        else:
            generate_terrain_duel_jungle()  # Default to advanced
    else:
        # FFA mode uses original map types
        if map_type == 'basic':
            generate_terrain_basic()
        elif map_type == 'advanced':
            generate_terrain_advanced()
        elif map_type == 'maze':
            generate_terrain_maze()
        else:
            generate_terrain_advanced()  # Default to advanced

    terrain_generated = True


def check_terrain_collision(x: float, y: float, width: float, height: float) -> bool:
    """Check if a rectangle collides with ramparts (bushes don't block movement)"""
    for obj in terrain:
        if obj['type'] != 'rampart':
            continue

        # AABB collision detection
        if (x < obj['x'] + obj['width'] and
            x + width > obj['x'] and
            y < obj['y'] + obj['height'] and
            y + height > obj['y']):
            return True
    return False


def check_in_bush(x: float, y: float) -> bool:
    """Check if a tank position is inside a bush (for invisibility)"""
    for obj in terrain:
        if obj['type'] != 'bush':
            continue

        # Check if tank center is inside bush
        if (x >= obj['x'] and x <= obj['x'] + obj['width'] and
            y >= obj['y'] and y <= obj['y'] + obj['height']):
            return True
    return False


def is_position_safe(x: float, y: float) -> bool:
    """Check if a position is safe for spawning (not in terrain or near other tanks)"""
    # Check terrain collision
    if check_terrain_collision(x - TANK_SIZE/2, y - TANK_SIZE/2, TANK_SIZE, TANK_SIZE):
        return False

    # Check base collision in Duel mode
    if current_game_mode == GAME_MODE_DUEL:
        # Check red base collision
        if red_base and red_base['health'] > 0:
            if (x + TANK_SIZE/2 > red_base['x'] and
                x - TANK_SIZE/2 < red_base['x'] + red_base['width'] and
                y + TANK_SIZE/2 > red_base['y'] and
                y - TANK_SIZE/2 < red_base['y'] + red_base['height']):
                return False

        # Check blue base collision
        if blue_base and blue_base['health'] > 0:
            if (x + TANK_SIZE/2 > blue_base['x'] and
                x - TANK_SIZE/2 < blue_base['x'] + blue_base['width'] and
                y + TANK_SIZE/2 > blue_base['y'] and
                y - TANK_SIZE/2 < blue_base['y'] + blue_base['height']):
                return False

    # Check distance from other tanks (use squared distance to avoid expensive sqrt)
    min_dist = TANK_SIZE * 3
    min_dist_squared = min_dist * min_dist
    for player_id, tank in players.items():
        dx = tank['x'] - x
        dy = tank['y'] - y
        if dx*dx + dy*dy < min_dist_squared:
            return False

    return True


def get_random_position() -> Tuple[float, float]:
    """Generate a random safe position in the arena"""
    attempts = 0
    while attempts < 100:
        x = random.uniform(TANK_SIZE * 2, ARENA_WIDTH - TANK_SIZE * 2)
        y = random.uniform(TANK_SIZE * 2, ARENA_HEIGHT - TANK_SIZE * 2)
        if is_position_safe(x, y):
            return (x, y)
        attempts += 1
    # If we can't find a safe position, return any position
    return (
        random.uniform(TANK_SIZE * 2, ARENA_WIDTH - TANK_SIZE * 2),
        random.uniform(TANK_SIZE * 2, ARENA_HEIGHT - TANK_SIZE * 2)
    )


def spawn_supply_drops():
    """Spawn 2 new supply drops at random locations (different types)"""
    global supply_drops, last_supply_drop_time

    # Clear only regular drops, keep super power-ups
    supply_drops = [drop for drop in supply_drops if drop['is_super']]

    # Pick 2 different power-up types
    available_types = ['fast_fire', 'fan_shot', 'speed_boost']
    random.shuffle(available_types)
    selected_types = available_types[:2]  # Pick first 2

    for powerup_type in selected_types:
        # Find safe position (not in walls)
        attempts = 0
        while attempts < 50:
            x = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2)
            y = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2)

            # Check not in rampart
            if not check_terrain_collision(x - SUPPLY_DROP_SIZE/2, y - SUPPLY_DROP_SIZE/2,
                                           SUPPLY_DROP_SIZE, SUPPLY_DROP_SIZE):
                supply_drops.append({
                    'x': x,
                    'y': y,
                    'size': SUPPLY_DROP_SIZE,
                    'type': powerup_type,
                    'is_super': False
                })
                print(f'📦 Supply drop spawned: {powerup_type.upper()} at ({int(x)}, {int(y)})')
                break
            attempts += 1
        else:
            # If can't find safe spot, spawn anyway
            supply_drops.append({
                'x': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2),
                'y': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2),
                'size': SUPPLY_DROP_SIZE,
                'type': powerup_type,
                'is_super': False
            })

    last_supply_drop_time = time.time()


def spawn_super_drop():
    """Spawn a super power-up (combines all abilities)"""
    global supply_drops, last_super_drop_time

    # Find safe position (not in walls)
    attempts = 0
    while attempts < 50:
        x = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2)
        y = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2)

        # Check not in rampart
        if not check_terrain_collision(x - SUPPLY_DROP_SIZE/2, y - SUPPLY_DROP_SIZE/2,
                                       SUPPLY_DROP_SIZE, SUPPLY_DROP_SIZE):
            supply_drops.append({
                'x': x,
                'y': y,
                'size': SUPPLY_DROP_SIZE * 1.3,  # Slightly larger
                'type': 'super_powerup',
                'is_super': True
            })
            last_super_drop_time = time.time()
            print(f'🌟 SUPER POWER-UP spawned at ({int(x)}, {int(y)})!')
            return
        attempts += 1

    # If can't find safe spot, spawn anyway
    supply_drops.append({
        'x': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2),
        'y': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2),
        'size': SUPPLY_DROP_SIZE * 1.3,
        'type': 'super_powerup',
        'is_super': True
    })
    last_super_drop_time = time.time()


def spawn_snake():
    """Spawn a huge snake that crosses the screen from a random edge with diagonal paths"""
    global snake, last_snake_time

    # Choose random direction (8 directions including diagonals)
    # 0=right, 1=down-right, 2=down, 3=down-left, 4=left, 5=up-left, 6=up, 7=up-right
    direction_index = random.randint(0, 7)
    direction = direction_index * (math.pi / 4)  # 45-degree increments

    # Calculate spawn position off-screen based on direction
    margin = SNAKE_LENGTH * 0.5  # Reduced margin so snake appears faster

    if direction_index == 0:  # Right (from left edge)
        x = -margin
        y = random.uniform(0, ARENA_HEIGHT)
    elif direction_index == 1:  # Down-Right (from top-left corner area)
        x = -margin
        y = -margin
    elif direction_index == 2:  # Down (from top edge)
        x = random.uniform(0, ARENA_WIDTH)
        y = -margin
    elif direction_index == 3:  # Down-Left (from top-right corner area)
        x = ARENA_WIDTH + margin
        y = -margin
    elif direction_index == 4:  # Left (from right edge)
        x = ARENA_WIDTH + margin
        y = random.uniform(0, ARENA_HEIGHT)
    elif direction_index == 5:  # Up-Left (from bottom-right corner area)
        x = ARENA_WIDTH + margin
        y = ARENA_HEIGHT + margin
    elif direction_index == 6:  # Up (from bottom edge)
        x = random.uniform(0, ARENA_WIDTH)
        y = ARENA_HEIGHT + margin
    else:  # 7 = Up-Right (from bottom-left corner area)
        x = -margin
        y = ARENA_HEIGHT + margin

    snake = {
        'x': x,
        'y': y,
        'direction': direction,
        'speed': SNAKE_SPEED,
        'length': SNAKE_LENGTH,
        'width': SNAKE_WIDTH,
        'health': 2000,
        'max_health': 2000
    }

    last_snake_time = time.time()
    direction_names = ['RIGHT', 'DOWN-RIGHT', 'DOWN', 'DOWN-LEFT', 'LEFT', 'UP-LEFT', 'UP', 'UP-RIGHT']
    print(f'🐍 HUGE SNAKE spawned! Position: ({int(x)}, {int(y)}) Direction: {direction_names[direction_index]} ({SNAKE_LENGTH_CELLS} cells long × {SNAKE_WIDTH_CELLS} cells wide) HP: 2000')
    print(f'   Arena size: {ARENA_WIDTH}×{ARENA_HEIGHT}, Snake will move at {SNAKE_SPEED} pixels/tick')


def update_snake():
    """Update snake position and check if it's off-screen"""
    global snake

    if snake is None:
        return

    # Move snake
    snake['x'] += math.cos(snake['direction']) * snake['speed']
    snake['y'] += math.sin(snake['direction']) * snake['speed']

    # Check if snake is completely off-screen (remove it)
    margin = SNAKE_LENGTH + 100
    if (snake['x'] < -margin or snake['x'] > ARENA_WIDTH + margin or
        snake['y'] < -margin or snake['y'] > ARENA_HEIGHT + margin):
        print(f'🐍 Snake left the screen at ({int(snake["x"])}, {int(snake["y"])})')
        snake = None


def check_snake_collision(tank: dict):
    """Check if tank collided with snake (instant death) - checks all 39 cells"""
    global snake

    if snake is None or not tank['alive']:
        return False

    # Check if tank is invincible
    current_time = time.time()
    is_invincible = (current_time < tank['invincible_until'] or
                    'invincibility_shield' in tank['powerups'] or
                    (tank['skill_active'] and tank['skill'] == 'ghost_mode'))

    if is_invincible:
        return False

    # Snake is 3 cells wide × 13 cells long = 39 total cells
    # Generate all 39 cell positions and check collision with each

    # Calculate all segments along the length (13 cells)
    segments = []
    for i in range(SNAKE_LENGTH_CELLS):
        t = i / (SNAKE_LENGTH_CELLS - 1) if SNAKE_LENGTH_CELLS > 1 else 0
        segment_x = snake['x'] - math.cos(snake['direction']) * snake['length'] * t
        segment_y = snake['y'] - math.sin(snake['direction']) * snake['length'] * t
        segments.append((segment_x, segment_y))

    # For each segment, check the 3 cells across the width
    perpendicular_angle = snake['direction'] + math.pi / 2

    for segment_x, segment_y in segments:
        # Check 3 cells wide (-1, 0, +1 offset from center)
        for width_offset in [-1, 0, 1]:
            cell_x = segment_x + math.cos(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE
            cell_y = segment_y + math.sin(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE

            # Check if tank bounding box overlaps with this snake cell
            # Tank bounding box
            tank_left = tank['x'] - TANK_SIZE / 2
            tank_right = tank['x'] + TANK_SIZE / 2
            tank_top = tank['y'] - TANK_SIZE / 2
            tank_bottom = tank['y'] + TANK_SIZE / 2

            # Snake cell bounding box
            cell_half_size = SNAKE_CELL_SIZE / 2
            cell_left = cell_x - cell_half_size
            cell_right = cell_x + cell_half_size
            cell_top = cell_y - cell_half_size
            cell_bottom = cell_y + cell_half_size

            # AABB collision detection
            if (tank_right > cell_left and tank_left < cell_right and
                tank_bottom > cell_top and tank_top < cell_bottom):
                return True

    return False


def spawn_shield_drop():
    """Spawn an invincibility shield drop"""
    global shield_drop, last_shield_drop_time

    # Find safe position (not in walls)
    attempts = 0
    while attempts < 50:
        x = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2)
        y = random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2)

        # Check not in rampart
        if not check_terrain_collision(x - SUPPLY_DROP_SIZE/2, y - SUPPLY_DROP_SIZE/2,
                                       SUPPLY_DROP_SIZE, SUPPLY_DROP_SIZE):
            shield_drop = {
                'x': x,
                'y': y,
                'size': SUPPLY_DROP_SIZE
            }
            last_shield_drop_time = time.time()
            print(f'🛡️  SHIELD DROP spawned at ({int(x)}, {int(y)})!')
            return
        attempts += 1

    # If can't find safe spot, spawn anyway
    shield_drop = {
        'x': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_WIDTH - SUPPLY_DROP_SIZE * 2),
        'y': random.uniform(SUPPLY_DROP_SIZE * 2, ARENA_HEIGHT - SUPPLY_DROP_SIZE * 2),
        'size': SUPPLY_DROP_SIZE
    }
    last_shield_drop_time = time.time()


def spawn_atomic_bomb():
    """Spawn an atomic bomb that can be collected and used once"""
    global atomic_bomb, last_atomic_bomb_time

    # Find safe position (not in walls)
    attempts = 0
    while attempts < 50:
        x = random.uniform(ATOMIC_BOMB_SIZE * 2, ARENA_WIDTH - ATOMIC_BOMB_SIZE * 2)
        y = random.uniform(ATOMIC_BOMB_SIZE * 2, ARENA_HEIGHT - ATOMIC_BOMB_SIZE * 2)

        # Check not in rampart
        if not check_terrain_collision(x - ATOMIC_BOMB_SIZE/2, y - ATOMIC_BOMB_SIZE/2,
                                       ATOMIC_BOMB_SIZE, ATOMIC_BOMB_SIZE):
            atomic_bomb = {
                'x': x,
                'y': y,
                'size': ATOMIC_BOMB_SIZE
            }
            last_atomic_bomb_time = time.time()
            print(f'💣 ATOMIC BOMB spawned at ({int(x)}, {int(y)})!')

            # Broadcast spawn notification
            socketio.emit('atomic_bomb_spawned', {
                'x': x,
                'y': y
            })
            return
        attempts += 1

    # If can't find safe spot, spawn anyway
    atomic_bomb = {
        'x': random.uniform(ATOMIC_BOMB_SIZE * 2, ARENA_WIDTH - ATOMIC_BOMB_SIZE * 2),
        'y': random.uniform(ATOMIC_BOMB_SIZE * 2, ARENA_HEIGHT - ATOMIC_BOMB_SIZE * 2),
        'size': ATOMIC_BOMB_SIZE
    }
    last_atomic_bomb_time = time.time()
    print(f'💣 ATOMIC BOMB spawned at ({int(atomic_bomb["x"])}, {int(atomic_bomb["y"])})!')


def select_captain():
    """Select a random alive player/bot as the captain"""
    global current_captain_id, last_captain_time

    # Get all alive players (including bots)
    alive_tanks = [pid for pid, tank in players.items() if tank['alive']]

    if not alive_tanks:
        print('⚠️ No alive tanks to select as captain')
        return

    # Randomly select a captain
    new_captain_id = random.choice(alive_tanks)

    # Remove captain status from previous captain
    if current_captain_id and current_captain_id in players:
        players[current_captain_id]['is_captain'] = False
        print(f'👑 {players[current_captain_id]["name"]} is no longer captain')

    # Set new captain
    current_captain_id = new_captain_id
    players[new_captain_id]['is_captain'] = True
    last_captain_time = time.time()

    captain_name = players[new_captain_id]['name']
    print(f'👑 {captain_name} has been selected as CAPTAIN! (+50% speed, 2-fan bullets, +50% fire rate)')

    # Broadcast captain selection
    socketio.emit('captain_selected', {
        'player_id': new_captain_id,
        'player_name': captain_name
    })


def check_atomic_bomb_collection(tank: dict):
    """Check if tank collected the atomic bomb"""
    global atomic_bomb

    if not tank['alive'] or atomic_bomb is None or tank.get('has_atomic_bomb', False):
        return False

    # Check distance to atomic bomb (use squared distance to avoid expensive sqrt)
    dx = tank['x'] - atomic_bomb['x']
    dy = tank['y'] - atomic_bomb['y']
    dist_squared = dx*dx + dy*dy

    # Collection radius
    if dist_squared < 900:  # 30 pixels
        tank['has_atomic_bomb'] = True
        atomic_bomb = None  # Remove bomb from map

        print(f'💣 {tank["name"]} collected ATOMIC BOMB!')

        # Broadcast collection
        socketio.emit('atomic_bomb_collected', {
            'player_id': tank['id'],
            'player_name': tank['name']
        })

        return True

    return False


def check_shield_collection(tank: dict):
    """Check if tank collected the shield drop"""
    global shield_drop

    if not tank['alive'] or shield_drop is None:
        return False

    # Check distance to shield drop (use squared distance to avoid expensive sqrt)
    dx = tank['x'] - shield_drop['x']
    dy = tank['y'] - shield_drop['y']
    dist_squared = dx*dx + dy*dy
    collection_radius = TANK_SIZE / 2 + shield_drop['size'] / 2

    if dist_squared < collection_radius * collection_radius:
        # Collected!
        if 'invincibility_shield' not in tank['powerups']:
            tank['powerups'].append('invincibility_shield')

        # Set timer if not already set or expired
        if tank['powerup_end_time'] == 0 or time.time() >= tank['powerup_end_time']:
            tank['powerup_end_time'] = time.time() + SHIELD_DURATION

        shield_drop = None
        return True

    return False


def check_supply_drop_collection(tank: dict):
    """Check if tank collected any supply drop"""
    global supply_drops

    if not tank['alive']:
        return None

    for drop in supply_drops[:]:  # Iterate over copy
        # Check distance between tank center and supply drop center (use squared distance to avoid expensive sqrt)
        dx = tank['x'] - drop['x']
        dy = tank['y'] - drop['y']
        dist_squared = dx * dx + dy * dy

        # Collection radius (tank size + supply drop size)
        collection_radius = (TANK_SIZE + drop['size']) / 2

        if dist_squared < collection_radius * collection_radius:
            # Add power-up to list (stacking)
            if drop['type'] == 'super_powerup':
                # Super power-up adds all 3 abilities
                for ability in ['fast_fire', 'fan_shot', 'speed_boost']:
                    if ability not in tank['powerups']:
                        tank['powerups'].append(ability)
                duration = SUPER_POWERUP_DURATION
            else:
                # Regular power-up
                if drop['type'] not in tank['powerups']:
                    tank['powerups'].append(drop['type'])
                duration = POWERUP_DURATION

            # Set timer based on first power-up collected
            if tank['powerup_end_time'] == 0 or time.time() >= tank['powerup_end_time']:
                tank['powerup_end_time'] = time.time() + duration
            # If already has active power-ups, new ones use same timer

            print(f'⚡ {tank["name"]} collected {drop["type"].upper()} power-up! Active: {tank["powerups"]}')

            # Remove supply drop
            supply_drops.remove(drop)
            return drop['type']

    return None


def update_powerups():
    """Update power-up timers and remove expired ones"""
    current_time = time.time()

    for player_id, tank in players.items():
        if tank['powerups'] and current_time >= tank['powerup_end_time']:
            print(f'⏰ {tank["name"]}\'s power-ups expired: {tank["powerups"]}')
            tank['powerups'] = []
            tank['powerup_end_time'] = 0


def update_skills():
    """Update active skills and handle cooldowns"""
    global snake
    current_time = time.time()

    for player_id, tank in players.items():
        # Cancel laser preparation if tank died
        if tank.get('laser_preparing', False) and not tank['alive']:
            tank['laser_preparing'] = False
            tank['laser_preparation_end'] = 0
            print(f'❌ {tank["name"]}\'s laser preparation cancelled - tank died!')

        # Cancel bomb preparation if tank died
        if tank.get('bomb_preparing', False) and not tank['alive']:
            tank['bomb_preparing'] = False
            tank['bomb_preparation_end'] = 0
            tank['has_atomic_bomb'] = False  # Drop the bomb
            print(f'❌ {tank["name"]}\'s bomb preparation cancelled - tank died!')

        # Handle laser beam preparation phase
        if tank.get('laser_preparing', False) and tank['alive'] and current_time >= tank['laser_preparation_end']:
            # Preparation complete, activate laser firing
            tank['laser_preparing'] = False
            tank['skill_active'] = True
            tank['skill_end_time'] = current_time + SKILL_LASER_BEAM_DURATION

            print(f'🔴 {tank["name"]} LASER FIRING! (0.5s)')

            # Broadcast laser firing notification
            socketio.emit('laser_firing', {
                'player_id': player_id,
                'player_name': tank['name']
            })

        # Handle laser beam post-firing cooldown (frozen state)
        if tank.get('laser_cooling_down', False) and current_time >= tank['laser_cooldown_end']:
            tank['laser_cooling_down'] = False
            print(f'✅ {tank["name"]} laser cooldown complete - movement restored')

        # Handle atomic bomb preparation phase
        if tank.get('bomb_preparing', False) and tank['alive'] and current_time >= tank['bomb_preparation_end']:
            # Preparation complete, DETONATE!
            tank['bomb_preparing'] = False
            tank['has_atomic_bomb'] = False  # Consume the bomb

            print(f'💣 {tank["name"]} BOMB DETONATING NOW!')

            # Execute detonation
            detonate_atomic_bomb(player_id, tank)

        # Handle atomic bomb post-detonation freeze
        if tank.get('bomb_freezing', False) and current_time >= tank['bomb_freeze_end']:
            tank['bomb_freezing'] = False
            print(f'✅ {tank["name"]} bomb freeze complete - movement restored')

        # Handle Laser Beam skill - instant kill in laser path
        if tank['skill_active'] and tank['skill'] == 'laser_beam' and tank['alive']:
            # Calculate laser endpoint
            laser_start_x = tank['x']
            laser_start_y = tank['y']
            laser_end_x = tank['x'] + math.cos(tank['angle']) * SKILL_LASER_RANGE
            laser_end_y = tank['y'] + math.sin(tank['angle']) * SKILL_LASER_RANGE

            # Initialize laser damage timer if not exists
            if 'laser_damage_timer' not in tank:
                tank['laser_damage_timer'] = 0
                tank['last_laser_log_time'] = 0  # For debugging

            # Check collision with snake (100 HP every 0.5s = every 15 ticks at 30 ticks/sec)
            if snake is not None and snake.get('health', 0) > 0:
                # Check if laser intersects with any of the 39 snake cells
                snake_hit = False

                # Calculate all segments along the length (13 cells)
                segments = []
                for i in range(SNAKE_LENGTH_CELLS):
                    t = i / (SNAKE_LENGTH_CELLS - 1) if SNAKE_LENGTH_CELLS > 1 else 0
                    segment_x = snake['x'] - math.cos(snake['direction']) * snake['length'] * t
                    segment_y = snake['y'] - math.sin(snake['direction']) * snake['length'] * t
                    segments.append((segment_x, segment_y))

                perpendicular_angle = snake['direction'] + math.pi / 2

                # Laser line parameters
                dx = laser_end_x - laser_start_x
                dy = laser_end_y - laser_start_y
                line_len_sq = dx*dx + dy*dy

                if line_len_sq > 0:  # Only check if laser has length
                    for segment_x, segment_y in segments:
                        for width_offset in [-1, 0, 1]:
                            cell_x = segment_x + math.cos(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE
                            cell_y = segment_y + math.sin(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE

                            # Project snake cell center onto laser line
                            t_proj = max(0, min(1, ((cell_x - laser_start_x) * dx + (cell_y - laser_start_y) * dy) / line_len_sq))
                            proj_x = laser_start_x + t_proj * dx
                            proj_y = laser_start_y + t_proj * dy

                            # Distance from snake cell to laser (use squared distance to avoid expensive sqrt)
                            dx_cell = cell_x - proj_x
                            dy_cell = cell_y - proj_y
                            dist_squared = dx_cell*dx_cell + dy_cell*dy_cell

                            # Laser width = 50 pixels (wider than tank size for easier hitting)
                            if dist_squared < 2500:  # 50*50
                                snake_hit = True
                                break

                        if snake_hit:
                            break

                # Deal damage every 15 ticks (0.5 seconds)
                if snake_hit:
                    tank['laser_damage_timer'] += 1

                    # Debug log every second (30 ticks)
                    if 'last_laser_log_time' not in tank:
                        tank['last_laser_log_time'] = 0
                    tank['last_laser_log_time'] += 1
                    if tank['last_laser_log_time'] >= 30:
                        tank['last_laser_log_time'] = 0
                        print(f'🔴 Laser hitting snake - timer: {tank["laser_damage_timer"]}/15')

                    if tank['laser_damage_timer'] >= 15:  # 0.5 seconds at 30 ticks/sec
                        tank['laser_damage_timer'] = 0
                        damage = 100
                        snake['health'] -= damage

                        print(f'🔴 Laser hit snake! HP: {snake["health"]}/{snake["max_health"]} (-{damage} damage from {tank["name"]})')

                        # Check if snake is destroyed
                        if snake['health'] <= 0:
                            # Award 500 points to the laser user
                            tank['score'] += 500

                            # Grant SNAKE SLAYER BUFF: 2x damage for 10 seconds
                            tank['snake_slayer_buff_end'] = time.time() + 10.0
                            print(f'💀 SNAKE DESTROYED by {tank["name"]}\'s LASER BEAM! +500 points')
                            print(f'⚔️ {tank["name"]} received SNAKE SLAYER buff (2x damage for 10s)!')

                            # Notify all players
                            socketio.emit('snake_destroyed', {
                                'killer_id': player_id,
                                'killer_name': tank['name']
                            })

                            snake = None  # Remove the snake
                else:
                    # Reset timer if not hitting snake
                    tank['laser_damage_timer'] = 0
                    if 'last_laser_log_time' in tank:
                        tank['last_laser_log_time'] = 0

            # Check all other tanks
            for target_id, target in players.items():
                if target_id == player_id or not target['alive']:
                    continue

                # Check if tank is in Ghost Mode (immune to laser)
                target_invincible = (target['skill_active'] and target['skill'] == 'ghost_mode') or \
                                   (current_time < target['invincible_until']) or \
                                   ('invincibility_shield' in target['powerups'])

                if target_invincible:
                    continue

                # Check if target intersects with laser line
                # Using point-to-line distance check
                dx = laser_end_x - laser_start_x
                dy = laser_end_y - laser_start_y
                line_len_sq = dx*dx + dy*dy

                if line_len_sq == 0:
                    continue

                # Project target position onto laser line
                t = max(0, min(1, ((target['x'] - laser_start_x) * dx + (target['y'] - laser_start_y) * dy) / line_len_sq))
                proj_x = laser_start_x + t * dx
                proj_y = laser_start_y + t * dy

                # Distance from target to laser (use squared distance to avoid expensive sqrt)
                dx_target = target['x'] - proj_x
                dy_target = target['y'] - proj_y
                dist_squared = dx_target*dx_target + dy_target*dy_target

                # Laser width = tank size
                if dist_squared < TANK_SIZE * TANK_SIZE:
                    # INSTANT KILL!
                    target['health'] = 0
                    target['alive'] = False
                    target['deaths'] += 1
                    target['respawn_timer'] = RESPAWN_TIME * GAME_TICK_RATE
                    tank['kills'] += 1
                    tank['score'] += 100

                    # Check if target was captain and remove status
                    was_captain = target.get('is_captain', False)
                    if was_captain:
                        target['is_captain'] = False
                        global current_captain_id
                        current_captain_id = None
                        print(f'👑🔴 Captain {target["name"]} killed by laser beam - status removed!')

                    socketio.emit('tank_destroyed', {
                        'victim_id': target_id,
                        'victim_name': target['name'],
                        'killer_id': player_id,
                        'killer_name': tank['name']
                    })

                    # If captain was killed, select new one immediately
                    if was_captain:
                        select_captain()

        # Check if skill duration ended
        if tank['skill_active'] and current_time >= tank['skill_end_time']:
            skill_names = {'speed_demon': 'Speed Demon', 'laser_beam': 'Laser Beam', 'ghost_mode': 'Ghost Mode'}
            print(f'⏰ {tank["name"]}\'s {skill_names.get(tank["skill"], tank["skill"])} ended - cooldown starting')

            tank['skill_active'] = False

            # For laser beam, enter post-firing frozen state
            if tank['skill'] == 'laser_beam':
                tank['laser_cooling_down'] = True
                tank['laser_cooldown_end'] = current_time + SKILL_LASER_BEAM_COOLDOWN
                print(f'❄️ {tank["name"]} entering post-laser cooldown (1s frozen)')
                # Full skill cooldown starts after post-firing phase ends
                tank['skill_cooldown_end'] = tank['laser_cooldown_end'] + SKILL_COOLDOWN
            else:
                # Start cooldown AFTER skill ends for other skills
                tank['skill_cooldown_end'] = current_time + SKILL_COOLDOWN


def get_team_assignment() -> str:
    """Assign player to team with least players in Duel mode"""
    if current_game_mode != GAME_MODE_DUEL:
        return None

    # Count players per team (excluding bots)
    red_count = sum(1 for p in players.values() if p.get('team') == 'red' and not p.get('is_bot'))
    blue_count = sum(1 for p in players.values() if p.get('team') == 'blue' and not p.get('is_bot'))

    # Check team size limits
    if red_count >= DUEL_MAX_TEAM_SIZE and blue_count >= DUEL_MAX_TEAM_SIZE:
        return None  # Both teams full

    # Assign to team with fewer players
    if red_count < blue_count:
        return 'red'
    elif blue_count < red_count:
        return 'blue'
    else:
        # Equal, assign randomly
        return random.choice(['red', 'blue'])


def get_team_spawn_position(team: str) -> Tuple[float, float]:
    """Get spawn position near team's core base (VERY CLOSE in Duel mode)"""
    if team == 'red' and red_base:
        # Spawn very close to red base (within 150 pixels)
        base_center_x = red_base['x'] + red_base['width'] / 2
        base_center_y = red_base['y'] + red_base['height'] / 2

        # Random position in a circle around the base
        angle = random.uniform(0, 2 * math.pi)
        distance = random.uniform(DUEL_BASE_SIZE / 2 + 50, DUEL_BASE_SIZE / 2 + 120)

        x = base_center_x + math.cos(angle) * distance
        y = base_center_y + math.sin(angle) * distance

        # Clamp to arena boundaries
        x = max(TANK_SIZE * 2, min(ARENA_WIDTH - TANK_SIZE * 2, x))
        y = max(TANK_SIZE * 2, min(ARENA_HEIGHT - TANK_SIZE * 2, y))

    elif team == 'blue' and blue_base:
        # Spawn very close to blue base (within 150 pixels)
        base_center_x = blue_base['x'] + blue_base['width'] / 2
        base_center_y = blue_base['y'] + blue_base['height'] / 2

        # Random position in a circle around the base
        angle = random.uniform(0, 2 * math.pi)
        distance = random.uniform(DUEL_BASE_SIZE / 2 + 50, DUEL_BASE_SIZE / 2 + 120)

        x = base_center_x + math.cos(angle) * distance
        y = base_center_y + math.sin(angle) * distance

        # Clamp to arena boundaries
        x = max(TANK_SIZE * 2, min(ARENA_WIDTH - TANK_SIZE * 2, x))
        y = max(TANK_SIZE * 2, min(ARENA_HEIGHT - TANK_SIZE * 2, y))

    else:
        # FFA or no team
        return get_random_position()

    # Make sure position is safe
    if is_position_safe(x, y):
        return (x, y)
    else:
        # Try a few more times near the base
        for _ in range(5):
            if team == 'red' and red_base:
                base_center_x = red_base['x'] + red_base['width'] / 2
                base_center_y = red_base['y'] + red_base['height'] / 2
                angle = random.uniform(0, 2 * math.pi)
                distance = random.uniform(DUEL_BASE_SIZE / 2 + 50, DUEL_BASE_SIZE / 2 + 150)
                x = base_center_x + math.cos(angle) * distance
                y = base_center_y + math.sin(angle) * distance
            elif team == 'blue' and blue_base:
                base_center_x = blue_base['x'] + blue_base['width'] / 2
                base_center_y = blue_base['y'] + blue_base['height'] / 2
                angle = random.uniform(0, 2 * math.pi)
                distance = random.uniform(DUEL_BASE_SIZE / 2 + 50, DUEL_BASE_SIZE / 2 + 150)
                x = base_center_x + math.cos(angle) * distance
                y = base_center_y + math.sin(angle) * distance

            x = max(TANK_SIZE * 2, min(ARENA_WIDTH - TANK_SIZE * 2, x))
            y = max(TANK_SIZE * 2, min(ARENA_HEIGHT - TANK_SIZE * 2, y))

            if is_position_safe(x, y):
                return (x, y)

        # Last resort - fall back to random
        return get_random_position()


def create_tank(player_id: str, name: str, color: str = None, icon: str = None, skill: str = None, team: str = None) -> dict:
    """Create a new tank for a player"""
    # Get position based on team or random
    if team and current_game_mode == GAME_MODE_DUEL:
        pos = get_team_spawn_position(team)
    else:
        pos = get_random_position()

    color_index = len(players) % len(TANK_COLORS)

    # Use custom color if provided, otherwise use team color or default
    if team == 'red':
        tank_color = '#FF0000'  # Red team
    elif team == 'blue':
        tank_color = '#0000FF'  # Blue team
    else:
        tank_color = color if color else TANK_COLORS[color_index]

    # Use custom icon if provided, otherwise default star
    tank_icon = icon if icon else '⭐'
    # Use selected skill or default to speed_demon
    tank_skill = skill if skill in ['speed_demon', 'laser_beam', 'ghost_mode'] else 'speed_demon'

    return {
        'id': player_id,
        'name': name,
        'x': pos[0],
        'y': pos[1],
        'angle': random.uniform(0, 2 * math.pi),
        'vx': 0,
        'vy': 0,
        'color': tank_color,
        'icon': tank_icon,
        'health': TANK_MAX_HEALTH,
        'max_health': TANK_MAX_HEALTH,
        'alive': True,
        'score': 0,
        'kills': 0,
        'deaths': 0,
        'shoot_cooldown': 0,
        'respawn_timer': 0,
        'powerups': [],  # List of active power-up types
        'powerup_end_time': 0,  # When all power-ups expire (based on first collected)
        'invincible_until': time.time() + 3.0,  # 3 seconds of spawn protection
        'skill': tank_skill,  # Ultimate skill type
        'skill_active': False,  # Whether skill is currently active
        'skill_end_time': 0,  # When current skill activation ends
        'skill_cooldown_end': 0,  # When skill becomes available again
        'snake_slayer_buff_end': 0,  # Snake Slayer buff: 2x damage for 10s after killing giant snake
        'laser_preparing': False,  # Laser beam preparation phase
        'laser_preparation_end': 0,  # When preparation ends and firing begins
        'laser_cooling_down': False,  # Laser beam post-firing frozen phase
        'laser_cooldown_end': 0,  # When post-firing freeze ends
        'has_atomic_bomb': False,  # Whether player has collected atomic bomb
        'bomb_preparing': False,  # Atomic bomb preparation phase
        'bomb_preparation_end': 0,  # When preparation ends and bomb detonates
        'bomb_freezing': False,  # Post-detonation freeze phase
        'bomb_freeze_end': 0,  # When freeze phase ends
        'is_captain': False,  # Whether this tank is the current captain
        'team': team,  # Team assignment ('red', 'blue', or None)
        # Emoji display (Press T to open picker client-side, T again to send)
        'emoji': None,              # Currently displayed emoji (None if not showing)
        'emoji_end_time': 0,        # Unix time when the displayed emoji expires
        'keys': {
            'w': False,
            'a': False,
            's': False,
            'd': False
        }
    }


def create_bot(bot_name: str, team: str = None) -> tuple:
    """Create a new AI bot tank and return (bot_id, bot_dict)"""
    global bot_counter

    bot_counter += 1
    bot_id = f'bot_{bot_counter}'

    # Get position based on team in Duel mode
    if team and current_game_mode == GAME_MODE_DUEL:
        pos = get_team_spawn_position(team)
    else:
        pos = get_random_position()

    # Random skill for bot
    bot_skill = random.choice(['speed_demon', 'laser_beam', 'ghost_mode'])

    # Random color for bot (or team color in Duel mode)
    if team == 'red':
        bot_color = '#FF0000'
    elif team == 'blue':
        bot_color = '#0000FF'
    else:
        bot_color = random.choice(TANK_COLORS)

    # Random icon for bot
    bot_icon = random.choice(['🤖', '⚙️', '🎯', '💀', '🔥'])

    bot_data = {
        'id': bot_id,
        'name': bot_name,
        'x': pos[0],
        'y': pos[1],
        'angle': random.uniform(0, 2 * math.pi),
        'vx': 0,
        'vy': 0,
        'color': bot_color,
        'icon': bot_icon,
        'health': TANK_MAX_HEALTH,
        'max_health': TANK_MAX_HEALTH,
        'alive': True,
        'score': 0,
        'kills': 0,
        'deaths': 0,
        'shoot_cooldown': 0,
        'respawn_timer': 0,
        'powerups': [],
        'powerup_end_time': 0,
        'invincible_until': time.time() + 3.0,
        'skill': bot_skill,
        'skill_active': False,
        'skill_end_time': 0,
        'skill_cooldown_end': 0,
        'snake_slayer_buff_end': 0,  # Snake Slayer buff
        'laser_preparing': False,  # Laser beam preparation phase
        'laser_preparation_end': 0,  # When preparation ends and firing begins
        'laser_cooling_down': False,  # Laser beam post-firing frozen phase
        'laser_cooldown_end': 0,  # When post-firing freeze ends
        'has_atomic_bomb': False,  # Whether bot has collected atomic bomb
        'bomb_preparing': False,  # Atomic bomb preparation phase
        'bomb_preparation_end': 0,  # When preparation ends and bomb detonates
        'bomb_freezing': False,  # Post-detonation freeze phase
        'bomb_freeze_end': 0,  # When freeze phase ends
        'is_captain': False,  # Whether this bot is the current captain
        'team': team,  # Team assignment for Duel mode
        'emoji': None,
        'emoji_end_time': 0,
        'keys': {
            'w': False,
            'a': False,
            's': False,
            'd': False
        },
        # Bot-specific AI fields
        'is_bot': True,
        'move_change_timer': 0,
        'shoot_timer': 0,
        'target_angle': random.uniform(0, 2 * math.pi)
    }

    return (bot_id, bot_data)


def spawn_bots(count: int = 2):
    """Spawn AI bots to play with a single human player"""
    global bots

    # In Duel mode with only one human player, bots join the opposing team
    if current_game_mode == GAME_MODE_DUEL:
        # Find the human player's team
        human_players = [p for p in players.values() if not p.get('is_bot', False)]

        if len(human_players) == 1:
            # Get the opposing team
            human_team = human_players[0].get('team')
            opposing_team = 'blue' if human_team == 'red' else 'red'

            print(f'🤖 Solo player detected! Spawning {count} bots on {opposing_team.upper()} team (player is on {human_team.upper()})')

            for i in range(count):
                bot_name = f'Bot_{random.choice(["Alpha", "Beta", "Gamma", "Delta", "Omega", "Zeta"])}'
                bot_id, bot_data = create_bot(bot_name, team=opposing_team)
                bots[bot_id] = bot_data
                players[bot_id] = bot_data
                print(f'🤖 Bot spawned: {bot_name} ({bot_id}) on {opposing_team.upper()} team')
        else:
            # Multiple human players - distribute bots evenly
            for i in range(count):
                bot_name = f'Bot_{random.choice(["Alpha", "Beta", "Gamma", "Delta", "Omega", "Zeta"])}'
                bot_team = get_team_assignment()  # Auto-balance
                if bot_team:
                    bot_id, bot_data = create_bot(bot_name, team=bot_team)
                    bots[bot_id] = bot_data
                    players[bot_id] = bot_data
                    print(f'🤖 Bot spawned: {bot_name} ({bot_id}) on {bot_team.upper()} team')
    else:
        # FFA mode - no teams
        for i in range(count):
            bot_name = f'Bot_{random.choice(["Alpha", "Beta", "Gamma", "Delta", "Omega", "Zeta"])}'
            bot_id, bot_data = create_bot(bot_name)
            bots[bot_id] = bot_data
            players[bot_id] = bot_data
            print(f'🤖 Bot spawned: {bot_name} ({bot_id})')

    # Notify all clients about new bots
    socketio.emit('bots_spawned', {'count': count})


def remove_all_bots():
    """Remove all AI bots from the game"""
    global bots

    if not bots:
        return

    bot_ids_to_remove = list(bots.keys())

    for bot_id in bot_ids_to_remove:
        if bot_id in players:
            bot_name = players[bot_id]['name']
            del players[bot_id]
            print(f'🤖 Bot removed: {bot_name} ({bot_id})')

        if bot_id in bots:
            del bots[bot_id]

    # Notify all clients
    socketio.emit('bots_removed', {})


def update_bot_ai(bot: dict):
    """Update bot AI behavior - random movement and shooting"""
    if not bot['alive'] or not bot.get('is_bot', False):
        return

    # Movement AI - change direction randomly
    bot['move_change_timer'] += 1

    if bot['move_change_timer'] >= BOT_MOVE_CHANGE_INTERVAL:
        bot['move_change_timer'] = 0

        # Randomly choose new movement keys
        bot['keys']['w'] = random.choice([True, False])
        bot['keys']['a'] = random.choice([True, False])
        bot['keys']['s'] = random.choice([True, False])
        bot['keys']['d'] = random.choice([True, False])

    # Rotation AI - slowly rotate towards random target angle
    bot['angle'] = bot['target_angle']

    # Every 2 seconds, pick a new random target angle
    if bot['move_change_timer'] == 0:
        bot['target_angle'] = random.uniform(0, 2 * math.pi)

    # Shooting AI - shoot randomly
    bot['shoot_timer'] += 1

    if bot['shoot_timer'] >= BOT_SHOOT_INTERVAL and bot['shoot_cooldown'] == 0:
        bot['shoot_timer'] = 0

        # Fire bullet
        has_fan_shot = 'fan_shot' in bot['powerups']
        has_fast_fire = 'fast_fire' in bot['powerups']

        if has_fan_shot:
            # Fire 3 bullets in fan pattern
            center_angle = bot['angle']
            spread_start = center_angle - FAN_SHOT_SPREAD / 2

            for i in range(FAN_SHOT_BULLETS):
                angle_offset = (FAN_SHOT_SPREAD / (FAN_SHOT_BULLETS - 1)) * i
                bullet_angle = spread_start + angle_offset
                bullet = create_bullet(bot, bullet_angle)
                bullets.append(bullet)
        else:
            # Fire single bullet
            bullet = create_bullet(bot, bot['angle'])
            bullets.append(bullet)

        # Set cooldown based on fast_fire
        if has_fast_fire:
            bot['shoot_cooldown'] = FAST_FIRE_COOLDOWN
        else:
            bot['shoot_cooldown'] = SHOOT_COOLDOWN


def check_and_manage_bots():
    """Check player count and spawn/remove bots as needed"""
    # Count human players (not bots)
    human_players = [p for p in players.values() if not p.get('is_bot', False)]
    human_count = len(human_players)
    bot_count = len(bots)

    # If only 1 human player and no bots, spawn 2 bots
    if human_count == 1 and bot_count == 0:
        print(f'👤 Only 1 human player detected - spawning 2 bots!')
        spawn_bots(2)

    # If 2+ human players and bots exist, remove all bots
    elif human_count >= 2 and bot_count > 0:
        print(f'👥 {human_count} human players detected - removing all bots!')
        remove_all_bots()


def update_tank_movement(tank: dict):
    """Update tank velocity based on key inputs"""
    if not tank['alive']:
        return

    # Freeze tank if preparing laser beam or in post-firing cooldown
    if tank.get('laser_preparing', False) or tank.get('laser_cooling_down', False):
        tank['vx'] = 0
        tank['vy'] = 0
        return

    # Freeze tank if preparing atomic bomb or in post-detonation freeze
    if tank.get('bomb_preparing', False) or tank.get('bomb_freezing', False):
        tank['vx'] = 0
        tank['vy'] = 0
        return

    # Reset velocity
    tank['vx'] = 0
    tank['vy'] = 0

    # Calculate movement based on pressed keys
    move_x = 0
    move_y = 0

    if tank['keys']['w']:
        move_y -= 1
    if tank['keys']['s']:
        move_y += 1
    if tank['keys']['a']:
        move_x -= 1
    if tank['keys']['d']:
        move_x += 1

    # Normalize diagonal movement
    if move_x != 0 or move_y != 0:
        magnitude = math.sqrt(move_x ** 2 + move_y ** 2)

        # Apply speed boost if active
        speed = TANK_SPEED
        if 'speed_boost' in tank['powerups']:
            speed = TANK_SPEED * SPEED_BOOST_MULTIPLIER

        # Apply Captain buff (+50% speed)
        if tank.get('is_captain', False):
            speed = TANK_SPEED * CAPTAIN_SPEED_MULTIPLIER

        # Apply Speed Demon ultimate skill boost (400% = 5x speed)
        if tank['skill_active'] and tank['skill'] == 'speed_demon':
            speed = TANK_SPEED * SKILL_SPEED_DEMON_SPEED_MULT

        tank['vx'] = (move_x / magnitude) * speed
        tank['vy'] = (move_y / magnitude) * speed

    # Store old position
    old_x = tank['x']
    old_y = tank['y']

    # Update position
    tank['x'] += tank['vx']
    tank['y'] += tank['vy']

    # Check terrain collision (ramparts block movement)
    # Ghost Mode allows phasing through walls
    is_ghost = tank['skill_active'] and tank['skill'] == 'ghost_mode'

    if not is_ghost:
        if check_terrain_collision(tank['x'] - TANK_SIZE/2, tank['y'] - TANK_SIZE/2, TANK_SIZE, TANK_SIZE):
            # Revert to old position
            tank['x'] = old_x
            tank['y'] = old_y

    # Check base collision in Duel mode - tanks cannot drive over core buildings (including Ghost Mode)
    if current_game_mode == GAME_MODE_DUEL:
        # Check red base collision
        if red_base and red_base['health'] > 0:
            if (tank['x'] + TANK_SIZE/2 > red_base['x'] and
                tank['x'] - TANK_SIZE/2 < red_base['x'] + red_base['width'] and
                tank['y'] + TANK_SIZE/2 > red_base['y'] and
                tank['y'] - TANK_SIZE/2 < red_base['y'] + red_base['height']):
                # Collision with red base - revert position
                tank['x'] = old_x
                tank['y'] = old_y

        # Check blue base collision
        if blue_base and blue_base['health'] > 0:
            if (tank['x'] + TANK_SIZE/2 > blue_base['x'] and
                tank['x'] - TANK_SIZE/2 < blue_base['x'] + blue_base['width'] and
                tank['y'] + TANK_SIZE/2 > blue_base['y'] and
                tank['y'] - TANK_SIZE/2 < blue_base['y'] + blue_base['height']):
                # Collision with blue base - revert position
                tank['x'] = old_x
                tank['y'] = old_y

    # Boundary collision - in Duel mode, Ghost Mode is also blocked by boundaries
    margin = TANK_SIZE / 2

    if current_game_mode == GAME_MODE_DUEL:
        # Duel mode: Hard boundaries, no wrap-around (even for Ghost Mode)
        if tank['x'] < margin:
            tank['x'] = margin
        elif tank['x'] > ARENA_WIDTH - margin:
            tank['x'] = ARENA_WIDTH - margin

        if tank['y'] < margin:
            tank['y'] = margin
        elif tank['y'] > ARENA_HEIGHT - margin:
            tank['y'] = ARENA_HEIGHT - margin
    else:
        # FFA mode: Wrap around edges
        if tank['x'] < margin:
            tank['x'] = ARENA_WIDTH - margin
        elif tank['x'] > ARENA_WIDTH - margin:
            tank['x'] = margin

        if tank['y'] < margin:
            tank['y'] = ARENA_HEIGHT - margin
        elif tank['y'] > ARENA_HEIGHT - margin:
            tank['y'] = margin


def check_win_condition():
    """Check if a team has won in Duel mode"""
    global game_winner, team_red_kills, team_blue_kills

    if current_game_mode != GAME_MODE_DUEL or game_winner is not None:
        return

    # Check kill count win condition
    if team_red_kills >= DUEL_WIN_KILLS:
        game_winner = 'red'
        print(f'🏆 RED TEAM WINS by reaching {DUEL_WIN_KILLS} kills!')
        socketio.emit('game_over', {'winner': 'red', 'reason': 'kills'})
        return

    if team_blue_kills >= DUEL_WIN_KILLS:
        game_winner = 'blue'
        print(f'🏆 BLUE TEAM WINS by reaching {DUEL_WIN_KILLS} kills!')
        socketio.emit('game_over', {'winner': 'blue', 'reason': 'kills'})
        return

    # Check base destruction win condition
    if red_base and red_base['health'] <= 0:
        game_winner = 'blue'
        print(f'🏰 BLUE TEAM WINS by destroying Red base!')
        socketio.emit('game_over', {'winner': 'blue', 'reason': 'base'})
        return

    if blue_base and blue_base['health'] <= 0:
        game_winner = 'red'
        print(f'🏰 RED TEAM WINS by destroying Blue base!')
        socketio.emit('game_over', {'winner': 'red', 'reason': 'base'})
        return


def update_bullets(current_time):
    """Update bullet positions and handle collisions"""
    global bullets, snake, red_base, blue_base, team_red_kills, team_blue_kills

    bullets_to_remove = []

    for bullet in bullets:
        # Update position
        bullet['x'] += bullet['vx']
        bullet['y'] += bullet['vy']
        bullet['lifetime'] -= 1

        # Wrap around edges
        if bullet['x'] < 0:
            bullet['x'] = ARENA_WIDTH
        elif bullet['x'] > ARENA_WIDTH:
            bullet['x'] = 0

        if bullet['y'] < 0:
            bullet['y'] = ARENA_HEIGHT
        elif bullet['y'] > ARENA_HEIGHT:
            bullet['y'] = 0

        # Remove if lifetime expired
        if bullet['lifetime'] <= 0:
            bullets_to_remove.append(bullet)
            continue

        # Check collision with ramparts - WITH RICOCHET!
        if check_terrain_collision(bullet['x'] - BULLET_SIZE/2, bullet['y'] - BULLET_SIZE/2, BULLET_SIZE, BULLET_SIZE):
            # Check if bullet can ricochet
            if bullet.get('ricochets_left', 0) > 0:
                # RICOCHET! Reflect bullet velocity based on which wall side was hit.
                # Determine hit side by checking collision from the previous position
                # along each axis independently:
                #   - If reverting X alone clears the collision -> hit a vertical wall (flip vx)
                #   - If reverting Y alone clears the collision -> hit a horizontal wall (flip vy)
                #   - If neither alone clears it -> corner hit (flip both)
                prev_x = bullet['x'] - bullet['vx']
                prev_y = bullet['y'] - bullet['vy']

                hit_vertical_wall = check_terrain_collision(
                    prev_x - BULLET_SIZE/2, bullet['y'] - BULLET_SIZE/2, BULLET_SIZE, BULLET_SIZE
                )
                hit_horizontal_wall = check_terrain_collision(
                    bullet['x'] - BULLET_SIZE/2, prev_y - BULLET_SIZE/2, BULLET_SIZE, BULLET_SIZE
                )

                if hit_vertical_wall and not hit_horizontal_wall:
                    # Hit a horizontal surface (top/bottom of rampart) -> flip vy
                    bullet['vy'] = -bullet['vy']
                elif hit_horizontal_wall and not hit_vertical_wall:
                    # Hit a vertical surface (left/right of rampart) -> flip vx
                    bullet['vx'] = -bullet['vx']
                else:
                    # Corner hit or ambiguous -> flip both
                    bullet['vx'] = -bullet['vx']
                    bullet['vy'] = -bullet['vy']

                bullet['ricochets_left'] -= 1

                # Move bullet back to previous (safe) position, then step forward
                # with the new velocity to prevent getting stuck inside the wall
                bullet['x'] = prev_x + bullet['vx']
                bullet['y'] = prev_y + bullet['vy']

                print(f'🔀 Bullet ricochet! {bullet["ricochets_left"]} bounces left')
            else:
                # No ricochets left, remove bullet
                bullets_to_remove.append(bullet)
                continue
        else:
            # Not colliding with wall, continue
            pass

        # Check collision with snake
        if snake is not None and snake['health'] > 0:
            # Check all 39 cells of the snake (13 length × 3 width)
            snake_hit = False
            segments = []
            for i in range(SNAKE_LENGTH_CELLS):
                t = i / (SNAKE_LENGTH_CELLS - 1) if SNAKE_LENGTH_CELLS > 1 else 0
                segment_x = snake['x'] - math.cos(snake['direction']) * snake['length'] * t
                segment_y = snake['y'] - math.sin(snake['direction']) * snake['length'] * t
                segments.append((segment_x, segment_y))

            perpendicular_angle = snake['direction'] + math.pi / 2

            for segment_x, segment_y in segments:
                for width_offset in [-1, 0, 1]:
                    cell_x = segment_x + math.cos(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE
                    cell_y = segment_y + math.sin(perpendicular_angle) * width_offset * SNAKE_CELL_SIZE

                    # Check if bullet hits this snake cell
                    cell_half_size = SNAKE_CELL_SIZE / 2
                    if (bullet['x'] >= cell_x - cell_half_size and bullet['x'] <= cell_x + cell_half_size and
                        bullet['y'] >= cell_y - cell_half_size and bullet['y'] <= cell_y + cell_half_size):
                        snake_hit = True
                        break
                if snake_hit:
                    break

            if snake_hit:
                # Damage the snake
                damage = bullet.get('damage', BULLET_DAMAGE)
                snake['health'] -= damage
                bullets_to_remove.append(bullet)

                print(f'🎯 Snake hit! HP: {snake["health"]}/{snake["max_health"]} (-{damage} damage)')

                # Check if snake is destroyed
                if snake['health'] <= 0:
                    # Award 500 points to the shooter
                    if bullet['owner_id'] in players:
                        killer = players[bullet['owner_id']]
                        killer['score'] += 500
                        killer_name = killer['name']

                        # Grant SNAKE SLAYER BUFF: 2x damage for 10 seconds
                        killer['snake_slayer_buff_end'] = time.time() + 10.0
                        print(f'💀 SNAKE DESTROYED by {killer_name}! +500 points')
                        print(f'⚔️ {killer_name} received SNAKE SLAYER buff (2x damage for 10s)!')

                        # Notify all players
                        socketio.emit('snake_destroyed', {
                            'killer_id': bullet['owner_id'],
                            'killer_name': killer_name
                        })

                    snake = None  # Remove the snake

                continue

        # Check collision with bases (Duel mode only)
        if current_game_mode == GAME_MODE_DUEL and bullet['owner_id'] in players:
            shooter_team = players[bullet['owner_id']].get('team')

            # Check red base collision (only blue team can damage)
            if shooter_team == 'blue' and red_base and red_base['health'] > 0:
                if (bullet['x'] >= red_base['x'] and bullet['x'] <= red_base['x'] + red_base['width'] and
                    bullet['y'] >= red_base['y'] and bullet['y'] <= red_base['y'] + red_base['height']):
                    damage = bullet.get('damage', BULLET_DAMAGE)
                    red_base['health'] -= damage
                    bullets_to_remove.append(bullet)
                    print(f'🏰 Red base hit! HP: {red_base["health"]}/{red_base["max_health"]} (-{damage} from {players[bullet["owner_id"]]["name"]})')

                    if red_base['health'] <= 0:
                        red_base['health'] = 0

                    continue

            # Check blue base collision (only red team can damage)
            if shooter_team == 'red' and blue_base and blue_base['health'] > 0:
                if (bullet['x'] >= blue_base['x'] and bullet['x'] <= blue_base['x'] + blue_base['width'] and
                    bullet['y'] >= blue_base['y'] and bullet['y'] <= blue_base['y'] + blue_base['height']):
                    damage = bullet.get('damage', BULLET_DAMAGE)
                    blue_base['health'] -= damage
                    bullets_to_remove.append(bullet)
                    print(f'🏰 Blue base hit! HP: {blue_base["health"]}/{blue_base["max_health"]} (-{damage} from {players[bullet["owner_id"]]["name"]})')

                    if blue_base['health'] <= 0:
                        blue_base['health'] = 0

                    continue

        # Check collision with tanks
        # Early skip for bullets far from any tanks (spatial optimization)
        closest_tank_dist = float('inf')
        for tank in players.values():
            if tank['alive']:
                dx = tank['x'] - bullet['x']
                dy = tank['y'] - bullet['y']
                dist = dx*dx + dy*dy  # Squared distance (faster than sqrt)
                if dist < closest_tank_dist:
                    closest_tank_dist = dist

        # Skip detailed checks if bullet is far from all tanks (>200px)
        if closest_tank_dist > 40000:  # 200*200
            continue

        for player_id, tank in players.items():
            if not tank['alive'] or player_id == bullet['owner_id']:
                continue

            # Friendly fire prevention in Duel mode
            if current_game_mode == GAME_MODE_DUEL and bullet['owner_id'] in players:
                shooter_team = players[bullet['owner_id']].get('team')
                target_team = tank.get('team')
                if shooter_team and target_team and shooter_team == target_team:
                    continue  # Skip friendly fire

            # Quick distance check before detailed collision (optimization)
            dx = tank['x'] - bullet['x']
            dy = tank['y'] - bullet['y']
            if dx*dx + dy*dy > 900:  # 30*30 (TANK_SIZE squared) - skip if too far
                continue

            # Check if tank is invincible (using cached current_time from game loop)
            is_invincible = (current_time < tank['invincible_until'] or
                           'invincibility_shield' in tank['powerups'] or
                           (tank['skill_active'] and tank['skill'] == 'ghost_mode'))

            # Square collision for square tanks
            tank_left = tank['x'] - TANK_SIZE / 2
            tank_right = tank['x'] + TANK_SIZE / 2
            tank_top = tank['y'] - TANK_SIZE / 2
            tank_bottom = tank['y'] + TANK_SIZE / 2

            if (bullet['x'] >= tank_left and bullet['x'] <= tank_right and
                bullet['y'] >= tank_top and bullet['y'] <= tank_bottom):
                # Hit! - but only damage if not invincible
                if not is_invincible:
                    tank['health'] -= bullet.get('damage', BULLET_DAMAGE)  # Use bullet's damage
                bullets_to_remove.append(bullet)

                # Check if tank is destroyed
                if tank['health'] <= 0:
                    tank['health'] = 0
                    tank['alive'] = False
                    tank['deaths'] += 1
                    tank['respawn_timer'] = RESPAWN_TIME * GAME_TICK_RATE  # Convert seconds to ticks

                    # Drop atomic bomb if player had one
                    if tank.get('has_atomic_bomb', False):
                        tank['has_atomic_bomb'] = False
                        print(f'💣 {tank["name"]} dropped atomic bomb on death!')

                    # Cancel any active preparation states
                    if tank.get('laser_preparing', False):
                        tank['laser_preparing'] = False
                        tank['laser_preparation_end'] = 0
                        print(f'❌ {tank["name"]}\'s laser preparation cancelled by death!')

                    if tank.get('bomb_preparing', False):
                        tank['bomb_preparing'] = False
                        tank['bomb_preparation_end'] = 0
                        print(f'❌ {tank["name"]}\'s bomb preparation cancelled by death!')

                    # Clear freeze states
                    tank['laser_cooling_down'] = False
                    tank['laser_cooldown_end'] = 0
                    tank['bomb_freezing'] = False
                    tank['bomb_freeze_end'] = 0

                    # Check if killed tank was captain BEFORE removing status
                    was_captain = tank.get('is_captain', False)

                    # Remove captain status on death
                    if was_captain:
                        tank['is_captain'] = False
                        global current_captain_id
                        current_captain_id = None
                        print(f'👑💀 Captain {tank["name"]} died - captain status removed!')

                    # Award kill to shooter
                    if bullet['owner_id'] in players:
                        shooter = players[bullet['owner_id']]
                        shooter['kills'] += 1

                        # Check if killed tank was captain (bonus +1000 points)
                        if was_captain:
                            shooter['score'] += 100 + CAPTAIN_KILL_REWARD  # 1100 total
                            print(f'👑💀 {shooter["name"]} killed CAPTAIN {tank["name"]}! +{100 + CAPTAIN_KILL_REWARD} points!')

                            # Broadcast captain kill
                            socketio.emit('captain_killed', {
                                'killer_id': shooter['id'],
                                'killer_name': shooter['name'],
                                'victim_name': tank['name']
                            })
                        else:
                            shooter['score'] += 100

                        # Update team kills in Duel mode
                        if current_game_mode == GAME_MODE_DUEL:
                            shooter_team = players[bullet['owner_id']].get('team')
                            if shooter_team == 'red':
                                team_red_kills += 1
                            elif shooter_team == 'blue':
                                team_blue_kills += 1

                    # Notify kill
                    socketio.emit('tank_destroyed', {
                        'victim_id': player_id,
                        'victim_name': tank['name'],
                        'killer_id': bullet['owner_id'],
                        'killer_name': players[bullet['owner_id']]['name'] if bullet['owner_id'] in players else 'Unknown'
                    })

                    # If captain died, immediately select a new one
                    if was_captain:
                        select_captain()

                break

    # Remove bullets
    for bullet in bullets_to_remove:
        if bullet in bullets:
            bullets.remove(bullet)


def create_bullet(tank: dict, target_angle: float) -> dict:
    """Create a bullet from a tank"""
    # Calculate damage (with Speed Demon bonus)
    damage = BULLET_DAMAGE
    if tank['skill_active'] and tank['skill'] == 'speed_demon':
        damage += SKILL_SPEED_DEMON_DAMAGE_BONUS  # +100 damage

    # Apply SNAKE SLAYER BUFF: 2x damage for 10s after killing giant snake
    if time.time() < tank.get('snake_slayer_buff_end', 0):
        damage *= 2
        print(f'⚔️ SNAKE SLAYER buff active for {tank["name"]}! Damage: {damage}')

    # Calculate max ricochets based on score
    max_ricochets = 0
    if tank['score'] >= RICOCHET_SCORE_2:
        max_ricochets = 2
    elif tank['score'] >= RICOCHET_SCORE_1:
        max_ricochets = 1

    return {
        'x': tank['x'] + math.cos(target_angle) * TANK_SIZE,
        'y': tank['y'] + math.sin(target_angle) * TANK_SIZE,
        'vx': math.cos(target_angle) * BULLET_SPEED,
        'vy': math.sin(target_angle) * BULLET_SPEED,
        'owner_id': tank['id'],
        'damage': damage,
        'lifetime': BULLET_LIFETIME,
        'ricochets_left': max_ricochets,  # Number of ricochets remaining
        'max_ricochets': max_ricochets  # For visual display
    }


def game_loop():
    """Main game loop that runs on the server"""
    global game_running, last_super_drop_time, snake, last_snake_time, shield_drop, last_shield_drop_time, atomic_bomb, last_atomic_bomb_time, current_captain_id, last_captain_time
    game_running = True

    while game_running:
        if players or bullets:
            # Cache current time for this tick (called many times, so cache it)
            current_time = time.time()

            # Check if we need to spawn regular supply drops (every 10s)
            if terrain_generated:
                if last_supply_drop_time == 0 or (current_time - last_supply_drop_time >= SUPPLY_DROP_INTERVAL):
                    spawn_supply_drops()  # Spawn 2 different power-ups

            # Check if we need to spawn super drop (every 60s)
            if terrain_generated and last_supply_drop_time > 0:  # Only after first regular drops
                if current_time - last_super_drop_time >= SUPER_DROP_INTERVAL:
                    spawn_super_drop()

            # Check if we need to spawn snake (every 30s)
            if terrain_generated:
                if last_snake_time == 0:
                    print(f'⏰ First snake spawn check - spawning now!')
                    spawn_snake()  # Spawn new snake every 30s (replaces previous one)
                elif current_time - last_snake_time >= SNAKE_INTERVAL:
                    print(f'⏰ 30 seconds passed - spawning new snake!')
                    spawn_snake()

            # Check if we need to spawn shield drop (every 10s)
            if terrain_generated:
                if last_shield_drop_time == 0 or (current_time - last_shield_drop_time >= SHIELD_DROP_INTERVAL):
                    if shield_drop is None:  # Only spawn if no shield is active
                        spawn_shield_drop()

            # Check if we need to spawn atomic bomb (every 60s)
            if terrain_generated:
                if last_atomic_bomb_time == 0 or (current_time - last_atomic_bomb_time >= ATOMIC_BOMB_INTERVAL):
                    if atomic_bomb is None:  # Only spawn if no bomb is active
                        spawn_atomic_bomb()

            # Check if we need to select initial captain or if no captain exists
            if terrain_generated and current_captain_id is None:
                # Select a captain if there isn't one (first time or after captain death with no replacement)
                select_captain()

            # Update power-up timers
            update_powerups()

            # Update active skills and cooldowns
            update_skills()

            # Update snake movement
            update_snake()

            # Debug: Show snake status every 3 seconds
            if snake and int(current_time) % 3 == 0:
                print(f'🐍 Snake active at ({int(snake["x"])}, {int(snake["y"])}) - direction: {snake["direction"]:.2f}')

            # Check and manage bot spawning/removal
            check_and_manage_bots()

            # Update all tanks
            for player_id, tank in list(players.items()):
                # Update bot AI if this is a bot
                if tank.get('is_bot', False) and tank['alive']:
                    update_bot_ai(tank)

                if tank['alive']:
                    update_tank_movement(tank)

                    # Check supply drop collection
                    collected_type = check_supply_drop_collection(tank)
                    if collected_type:
                        socketio.emit('supply_collected', {
                            'player_id': player_id,
                            'powerup_type': collected_type
                        })

                    # Check shield drop collection
                    if check_shield_collection(tank):
                        socketio.emit('supply_collected', {
                            'player_id': player_id,
                            'powerup_type': 'invincibility_shield'
                        })

                    # Check atomic bomb collection
                    check_atomic_bomb_collection(tank)

                    # Check snake collision (instant death)
                    if check_snake_collision(tank):
                        tank['alive'] = False
                        tank['health'] = 0
                        tank['respawn_timer'] = RESPAWN_TIME * GAME_TICK_RATE
                        tank['deaths'] += 1

                        # Drop atomic bomb if player had one
                        if tank.get('has_atomic_bomb', False):
                            tank['has_atomic_bomb'] = False
                            print(f'💣 {tank["name"]} dropped atomic bomb on death by snake!')

                        # Cancel any active preparation states
                        if tank.get('laser_preparing', False):
                            tank['laser_preparing'] = False
                            tank['laser_preparation_end'] = 0
                            print(f'❌ {tank["name"]}\'s laser preparation cancelled by snake!')

                        if tank.get('bomb_preparing', False):
                            tank['bomb_preparing'] = False
                            tank['bomb_preparation_end'] = 0
                            print(f'❌ {tank["name"]}\'s bomb preparation cancelled by snake!')

                        # Clear freeze states
                        tank['laser_cooling_down'] = False
                        tank['laser_cooldown_end'] = 0
                        tank['bomb_freezing'] = False
                        tank['bomb_freeze_end'] = 0

                        # Remove captain status on death by snake
                        was_captain = tank.get('is_captain', False)
                        if was_captain:
                            tank['is_captain'] = False
                            current_captain_id = None
                            print(f'👑🐍 Captain {tank["name"]} killed by snake - status removed!')

                        socketio.emit('death', {
                            'id': player_id,
                            'killer': 'Snake',
                            'killed': tank['name']
                        })

                        # If captain died, immediately select a new one
                        if was_captain:
                            select_captain()
                else:
                    # Handle respawn timer
                    if tank['respawn_timer'] > 0:
                        tank['respawn_timer'] -= 1
                        if tank['respawn_timer'] == 0:
                            # Auto-respawn
                            old_name = tank['name']
                            old_color = tank['color']
                            old_icon = tank['icon']
                            old_skill = tank['skill']
                            old_score = tank['score']
                            old_kills = tank['kills']
                            old_deaths = tank['deaths']
                            old_skill_cooldown_end = tank['skill_cooldown_end']
                            is_bot = tank.get('is_bot', False)

                            # Preserve team in Duel mode
                            old_team = tank.get('team')

                            if is_bot:
                                # Respawn bot with same team
                                bot_id, new_tank = create_bot(old_name, team=old_team)
                                new_tank['score'] = old_score
                                new_tank['kills'] = old_kills
                                new_tank['deaths'] = old_deaths
                                new_tank['skill_cooldown_end'] = old_skill_cooldown_end
                                # Keep the same ID for consistency
                                new_tank['id'] = player_id
                                players[player_id] = new_tank
                                bots[player_id] = new_tank
                            else:
                                # Respawn human player near their team's core base
                                new_tank = create_tank(player_id, old_name, old_color, old_icon, old_skill, team=old_team)
                                new_tank['score'] = old_score
                                new_tank['kills'] = old_kills
                                new_tank['deaths'] = old_deaths
                                new_tank['skill_cooldown_end'] = old_skill_cooldown_end  # Preserve cooldown
                                players[player_id] = new_tank

                            socketio.emit('respawned', {
                                'id': player_id,
                                'name': old_name,
                                'color': old_color
                            })

                # Update cooldowns
                if tank['shoot_cooldown'] > 0:
                    tank['shoot_cooldown'] -= 1

            # Update bullets (pass current_time for invincibility checks)
            update_bullets(current_time)

            # Check win condition (Duel mode only)
            if current_game_mode == GAME_MODE_DUEL:
                check_win_condition()

            # Prepare game state
            game_state = {
                'players': [
                    {
                        'id': t['id'],
                        'name': t['name'],
                        'x': t['x'],
                        'y': t['y'],
                        'angle': t['angle'],
                        'color': t['color'],
                        'icon': t['icon'],
                        'health': t['health'],
                        'max_health': t['max_health'],
                        'alive': t['alive'],
                        'score': t['score'],
                        'kills': t['kills'],
                        'deaths': t['deaths'],
                        'respawn_timer': round(t['respawn_timer'] / GAME_TICK_RATE, 1),  # Convert to seconds
                        'hidden': check_in_bush(t['x'], t['y']) if t['alive'] else False,  # Hidden if in bush
                        'powerups': t['powerups'],  # List of active power-ups
                        'powerup_time_left': max(0, t['powerup_end_time'] - time.time()) if t['powerups'] else 0,
                        'invincible': time.time() < t['invincible_until'] or 'invincibility_shield' in t['powerups'],
                        'skill': t['skill'],  # Ultimate skill type
                        'skill_active': t['skill_active'],  # Whether skill is currently active
                        'skill_time_left': max(0, t['skill_end_time'] - time.time()) if t['skill_active'] else 0,
                        'skill_cooldown': max(0, t['skill_cooldown_end'] - time.time()),
                        'laser_preparing': t.get('laser_preparing', False),  # Laser beam preparation phase
                        'laser_preparation_time_left': max(0, t.get('laser_preparation_end', 0) - time.time()) if t.get('laser_preparing', False) else 0,
                        'laser_cooling_down': t.get('laser_cooling_down', False),  # Laser beam post-firing frozen
                        'has_atomic_bomb': t.get('has_atomic_bomb', False),  # Has atomic bomb ready to use
                        'bomb_preparing': t.get('bomb_preparing', False),  # Atomic bomb preparation phase
                        'bomb_preparation_time_left': max(0, t.get('bomb_preparation_end', 0) - time.time()) if t.get('bomb_preparing', False) else 0,
                        'bomb_freezing': t.get('bomb_freezing', False),  # Post-detonation freeze
                        'is_captain': t.get('is_captain', False),  # Captain status
                        'is_bot': t.get('is_bot', False),  # Identify bots
                        'team': t.get('team'),  # Team assignment (red, blue, or None)
                        # Emoji display: only send while alive and not expired
                        'emoji': (
                            t.get('emoji')
                            if (t.get('alive') and t.get('emoji')
                                and time.time() < t.get('emoji_end_time', 0))
                            else None
                        )
                    }
                    for t in players.values()
                ],
                'bullets': [
                    {
                        'x': b['x'],
                        'y': b['y'],
                        'vx': b['vx'],
                        'vy': b['vy']
                    }
                    for b in bullets
                ],
                # Terrain is sent once on connection, not every frame (optimization)
                'supply_drops': supply_drops,  # Include all active supply drops
                'snake': snake,  # Include snake if active
                'shield_drop': shield_drop,  # Include shield drop if active
                'atomic_bomb': atomic_bomb,  # Include atomic bomb if active
                'game_mode': current_game_mode,  # Current game mode (ffa or duel)
                'red_base': red_base,  # Red team base (Duel mode)
                'blue_base': blue_base,  # Blue team base (Duel mode)
                'team_red_kills': team_red_kills,  # Red team kill count
                'team_blue_kills': team_blue_kills,  # Blue team kill count
                'game_winner': game_winner  # Winner ('red', 'blue', or None)
            }

            # Broadcast game state to all clients
            socketio.emit('game_state', game_state, namespace='/')

        # Sleep to maintain tick rate
        import gevent
        gevent.sleep(1.0 / GAME_TICK_RATE)


@app.route('/')
def index():
    """Serve the main game page"""
    return render_template('index.html')


@app.route('/static/<path:path>')
def send_static(path):
    """Serve static files"""
    return send_from_directory('static', path)


@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    try:
        client_ip = request.environ.get('REMOTE_ADDR', 'unknown')
        print(f'✓ WebSocket client connected: {request.sid} from {client_ip}')
        emit('connected', {'id': request.sid})
    except Exception as e:
        print(f'✗ Connection error: {e}')


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    try:
        player_id = request.sid
        client_ip = request.environ.get('REMOTE_ADDR', 'unknown')

        if player_id in players:
            # Don't remove if it's a bot (bots are managed separately)
            if not players[player_id].get('is_bot', False):
                player_name = players[player_id]['name']
                print(f'✓ Player disconnected: {player_name} ({player_id}) from {client_ip}')
                del players[player_id]
                socketio.emit('player_left', {'id': player_id, 'name': player_name})

                # Check if we need to spawn bots after this disconnect
                # (will be handled in next game loop tick)
        else:
            print(f'✓ Client disconnected: {player_id} from {client_ip}')
    except Exception as e:
        print(f'✗ Disconnect error: {e}')


@socketio.on('join_game')
def handle_join_game(data):
    """Handle a player joining the game"""
    try:
        global terrain_generated

        player_id = request.sid
        player_name = data.get('name', f'Tank{len(players) + 1}')
        game_mode_choice = data.get('game_mode', 'ffa')  # Get player's game mode choice
        map_choice = data.get('map_type', 'advanced')  # Get player's map choice
        player_color = data.get('color', None)  # Get custom color
        player_icon = data.get('icon', None)  # Get custom icon
        player_skill = data.get('skill', 'speed_demon')  # Get selected ultimate skill
        client_ip = request.environ.get('REMOTE_ADDR', 'unknown')

        # Record game mode vote
        if game_mode_choice in ['ffa', 'duel']:
            game_mode_votes[player_id] = game_mode_choice

        # Record map vote (only used in FFA mode)
        if map_choice in ['basic', 'advanced', 'maze']:
            map_votes[player_id] = map_choice

        # If this is the first player, generate terrain based on their choices
        if not terrain_generated:
            generate_terrain(map_choice, game_mode_choice)
            rampart_count = len([t for t in terrain if t["type"] == "rampart"])
            bush_count = len([t for t in terrain if t["type"] == "bush"])
            if current_game_mode == GAME_MODE_DUEL:
                print(f'🏰 Generated DUEL map: {rampart_count} walls, {bush_count} bushes, 2 team bases')
            else:
                print(f'🗺️  Generated {current_map_type.upper()} map: {rampart_count} walls, {bush_count} bushes')

        # Assign team in Duel mode
        player_team = None
        if current_game_mode == GAME_MODE_DUEL:
            player_team = get_team_assignment()
            if player_team is None:
                # Both teams full, reject join
                emit('join_failed', {'reason': 'Both teams are full (max 5 per team)'})
                return

        # Create new tank for player with customization and team
        players[player_id] = create_tank(player_id, player_name, player_color, player_icon, player_skill, player_team)

        skill_names = {'speed_demon': 'Speed Demon⚡', 'laser_beam': 'Laser Beam🔴', 'ghost_mode': 'Ghost Mode👻'}
        team_str = f' - Team: {player_team.upper()}' if player_team else ''
        print(f'🎮 Player joined: {player_name} ({player_id}) from {client_ip} - Skill: {skill_names.get(player_skill, player_skill)}{team_str}')

        # Send initial game state to the new player (including terrain - only sent once)
        emit('game_joined', {
            'id': player_id,
            'name': player_name,
            'color': players[player_id]['color'],
            'map_type': current_map_type,
            'game_mode': current_game_mode,
            'team': player_team,
            'terrain': terrain  # Send terrain once on join (optimization)
        })

        # Notify all players about the new player
        socketio.emit('player_joined', {
            'id': player_id,
            'name': player_name,
            'color': players[player_id]['color'],
            'team': player_team
        })
    except Exception as e:
        print(f'✗ Error joining game: {e}')


@socketio.on('key_state')
def handle_key_state(data):
    """Handle key state updates from client"""
    player_id = request.sid

    if player_id in players:
        tank = players[player_id]
        key = data.get('key')
        pressed = data.get('pressed', False)

        if key in tank['keys']:
            tank['keys'][key] = pressed


@socketio.on('rotate')
def handle_rotate(data):
    """Handle tank rotation"""
    player_id = request.sid

    if player_id in players and players[player_id]['alive']:
        angle = data.get('angle')
        if angle is not None:
            players[player_id]['angle'] = angle


@socketio.on('shoot')
def handle_shoot():
    """Handle shooting request"""
    player_id = request.sid

    if player_id in players:
        tank = players[player_id]

        if tank['alive'] and tank['shoot_cooldown'] == 0:
            # Check for stacked power-ups
            has_fan_shot = 'fan_shot' in tank['powerups']
            has_fast_fire = 'fast_fire' in tank['powerups']
            is_captain = tank.get('is_captain', False)

            # Captain always fires 2-fan bullets (or use fan shot if they have it)
            if has_fan_shot or is_captain:
                # Fire bullets in fan pattern
                num_bullets = FAN_SHOT_BULLETS if has_fan_shot else 2  # Captain fires 2 bullets
                center_angle = tank['angle']
                spread = FAN_SHOT_SPREAD if has_fan_shot else 0.2  # Smaller spread for captain

                if num_bullets == 1:
                    # Single bullet
                    bullet = create_bullet(tank, center_angle)
                    bullets.append(bullet)
                else:
                    spread_start = center_angle - spread / 2
                    for i in range(num_bullets):
                        angle_offset = (spread / (num_bullets - 1)) * i
                        bullet_angle = spread_start + angle_offset
                        bullet = create_bullet(tank, bullet_angle)
                        bullets.append(bullet)
            else:
                # Fire single bullet
                bullet = create_bullet(tank, tank['angle'])
                bullets.append(bullet)

            # Set cooldown based on fast_fire or captain buff
            if has_fast_fire:
                tank['shoot_cooldown'] = FAST_FIRE_COOLDOWN
            elif is_captain:
                # Captain has 50% faster fire rate (cooldown reduced to 67%)
                tank['shoot_cooldown'] = int(SHOOT_COOLDOWN / CAPTAIN_FIRE_RATE_MULTIPLIER)
            else:
                tank['shoot_cooldown'] = SHOOT_COOLDOWN

            # Notify about shot
            emit('shot_fired', {'player_id': player_id})


@socketio.on('activate_skill')
def handle_activate_skill():
    """Handle ultimate skill activation (Press 'C')"""
    player_id = request.sid

    if player_id in players:
        tank = players[player_id]
        current_time = time.time()

        if not tank['alive']:
            return

        # Check if skill is already active
        if tank['skill_active']:
            return

        # Check if skill is on cooldown
        if current_time < tank['skill_cooldown_end']:
            cooldown_left = int(tank['skill_cooldown_end'] - current_time)
            print(f'⏰ {tank["name"]} tried to activate skill - {cooldown_left}s cooldown remaining')
            return

        # Activate skill!
        skill = tank['skill']
        skill_names = {'speed_demon': 'Speed Demon ⚡', 'laser_beam': 'Laser Beam 🔴', 'ghost_mode': 'Ghost Mode 👻'}

        if skill == 'laser_beam':
            # Laser beam starts with preparation phase
            tank['laser_preparing'] = True
            tank['laser_preparation_end'] = current_time + SKILL_LASER_BEAM_PREPARATION
            print(f'⚠️ {tank["name"]} PREPARING LASER BEAM... (1s warning)')

            # Broadcast warning to all players
            socketio.emit('laser_warning', {
                'player_id': player_id,
                'player_name': tank['name'],
                'duration': SKILL_LASER_BEAM_PREPARATION
            })
        else:
            # Other skills activate immediately
            if skill == 'speed_demon':
                duration = SKILL_SPEED_DEMON_DURATION
            else:  # ghost_mode
                duration = SKILL_GHOST_MODE_DURATION

            tank['skill_active'] = True
            tank['skill_end_time'] = current_time + duration

            print(f'💥 {tank["name"]} activated {skill_names.get(skill, skill)}! ({duration}s duration)')

            socketio.emit('skill_activated', {
                'player_id': player_id,
                'skill': skill,
                'duration': duration
            })


def detonate_atomic_bomb(player_id: str, tank: dict):
    """Execute the atomic bomb detonation and kill all non-invincible players"""
    current_time = time.time()

    print(f'💣💥 {tank["name"]} ATOMIC BOMB DETONATED! Screen-wide explosion!')

    # Count kills and update scores
    kills_count = 0
    victims = []

    for target_id, target in players.items():
        if target_id == player_id or not target['alive']:
            continue

        # Check if target is invincible
        target_invincible = (
            (target['skill_active'] and target['skill'] == 'ghost_mode') or
            (current_time < target['invincible_until']) or
            ('invincibility_shield' in target['powerups'])
        )

        if target_invincible:
            print(f'  🛡️ {target["name"]} survived - invincible!')
            continue

        # KILL THE TARGET!
        target['health'] = 0
        target['alive'] = False
        target['deaths'] += 1
        target['respawn_timer'] = RESPAWN_TIME * GAME_TICK_RATE
        kills_count += 1
        victims.append(target['name'])

        # Check if target was captain and remove status
        was_captain = target.get('is_captain', False)
        if was_captain:
            target['is_captain'] = False
            global current_captain_id
            current_captain_id = None
            print(f'👑💣 Captain {target["name"]} killed by atomic bomb - status removed!')

        # Update team kills in Duel mode
        if current_game_mode == GAME_MODE_DUEL and tank.get('team') and target.get('team'):
            if tank['team'] == 'red':
                global team_red_kills
                team_red_kills += 1
            elif tank['team'] == 'blue':
                global team_blue_kills
                team_blue_kills += 1

        # Individual kill notification
        socketio.emit('tank_destroyed', {
            'victim_id': target_id,
            'victim_name': target['name'],
            'killer_id': player_id,
            'killer_name': tank['name']
        })

        # If captain was killed, select new one immediately
        if was_captain:
            select_captain()

    # Award points for kills
    tank['kills'] += kills_count
    tank['score'] += kills_count * 100

    print(f'  💀 {kills_count} players killed: {", ".join(victims) if victims else "None (all invincible)"}')

    # Start post-detonation freeze
    tank['bomb_freezing'] = True
    tank['bomb_freeze_end'] = current_time + ATOMIC_BOMB_FREEZE
    print(f'❄️ {tank["name"]} entering post-detonation freeze (2s)')

    # Broadcast atomic bomb explosion event
    socketio.emit('atomic_bomb_exploded', {
        'player_id': player_id,
        'player_name': tank['name'],
        'kills': kills_count,
        'victims': victims
    })


@socketio.on('show_emoji')
def handle_show_emoji(data):
    """Handle the player confirming an emoji from the picker.

    Client opens a picker with T, navigates with arrow keys, then presses T
    again to broadcast their chosen emoji to all players via game_state.
    """
    player_id = request.sid

    if player_id not in players:
        return

    tank = players[player_id]
    if not tank.get('alive', False):
        return

    chosen = data.get('emoji') if isinstance(data, dict) else None
    # Only accept emojis from the official list (server-side validation)
    if chosen not in EMOJI_LIST:
        return

    tank['emoji'] = chosen
    tank['emoji_end_time'] = time.time() + EMOJI_DISPLAY_DURATION


@socketio.on('activate_atomic_bomb')
def handle_activate_atomic_bomb():
    """Handle atomic bomb activation (Press 'X')"""
    player_id = request.sid

    if player_id in players:
        tank = players[player_id]
        current_time = time.time()

        if not tank['alive']:
            return

        # Check if player has atomic bomb
        if not tank.get('has_atomic_bomb', False):
            print(f'❌ {tank["name"]} tried to use atomic bomb but doesn\'t have one!')
            return

        # Check if already preparing or freezing
        if tank.get('bomb_preparing', False) or tank.get('bomb_freezing', False):
            return

        # Start preparation phase (3 seconds)
        tank['bomb_preparing'] = True
        tank['bomb_preparation_end'] = current_time + ATOMIC_BOMB_PREPARATION
        print(f'⚠️ {tank["name"]} PREPARING ATOMIC BOMB... (3s warning)')

        # Broadcast warning to all players
        socketio.emit('bomb_warning', {
            'player_id': player_id,
            'player_name': tank['name'],
            'duration': ATOMIC_BOMB_PREPARATION
        })


def start_server(host='0.0.0.0', port=8051):
    """Start the game server"""
    import gevent

    # Don't generate terrain at startup - wait for first player to choose map type
    # Terrain will be generated when first player joins with their map choice

    # Start game loop in background
    gevent.spawn(game_loop)

    print(f'Starting Tank Battle Multiplayer Server on {host}:{port}')
    print(f'Open http://localhost:{port} in your browser to play!')
    print(f'Waiting for first player to select map type...')

    # Run the server
    socketio.run(app, host=host, port=port, debug=False)


if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = 8051

    start_server(port=port)
