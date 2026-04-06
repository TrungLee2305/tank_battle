#!/usr/bin/env python3
"""
Interactive script to change the Tank Battle map type
"""

import sys

def change_map_type():
    print("=" * 60)
    print("Tank Battle - Map Type Selector")
    print("=" * 60)
    print()
    print("Available Map Types:")
    print()
    print("1. BASIC    - Simple scattered walls (Easy)")
    print("             10-15 bar walls, 15-25 bushes")
    print("             Good for beginners, fast-paced action")
    print()
    print("2. ADVANCED - Strategic formations (Medium)")
    print("             Central cross + corner positions")
    print("             ~20 walls, 20-30 bushes")
    print("             Balanced tactical gameplay (DEFAULT)")
    print()
    print("3. MAZE     - Complex maze structure (Hard)")
    print("             Grid-based maze with 40+ walls")
    print("             25-40 bushes, stealth-focused")
    print()
    print("=" * 60)
    print()

    choice = input("Select map type (1-3) or press Enter for Advanced: ").strip()

    map_types = {
        '1': 'basic',
        '2': 'advanced',
        '3': 'maze',
        '': 'advanced'  # Default
    }

    if choice not in map_types:
        print("Invalid choice. Using default (Advanced)")
        choice = ''

    selected_map = map_types[choice]

    # Read the current file
    with open('tank_server.py', 'r') as f:
        lines = f.readlines()

    # Find and replace the MAP_TYPE line
    for i, line in enumerate(lines):
        if line.strip().startswith("MAP_TYPE ="):
            lines[i] = f"MAP_TYPE = '{selected_map}'  # Change this to switch map layouts\n"
            break

    # Write back
    with open('tank_server.py', 'w') as f:
        f.writelines(lines)

    print()
    print(f"✓ Map type changed to: {selected_map.upper()}")
    print()
    print("Map descriptions:")

    descriptions = {
        'basic': "Simple scattered bar walls - great for beginners and fast combat",
        'advanced': "Strategic layout with cross formation - balanced tactical gameplay",
        'maze': "Complex maze structure - challenging stealth-focused battles"
    }

    print(f"  {descriptions[selected_map]}")
    print()
    print("Restart the server for changes to take effect:")
    print("  ./start_server.sh")
    print()
    print("=" * 60)

if __name__ == '__main__':
    try:
        change_map_type()
    except KeyboardInterrupt:
        print("\n\nCancelled.")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)
