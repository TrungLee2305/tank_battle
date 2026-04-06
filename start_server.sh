#!/bin/bash

echo "Starting Tank Battle Multiplayer Server..."
echo "==========================================="

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Start the server
echo "Starting server on port 8051..."
echo "Open http://localhost:8051 in your browser to play!"
echo "==========================================="
python3 tank_server.py
