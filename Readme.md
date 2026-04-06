# Tank Battle - Docker Deployment Guide

## Quick Start with Docker Compose (Recommended)

### Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+

### Deploy the Game

1. **Build and start the container:**
   ```bash
   docker-compose up -d
   ```

2. **Access the game:**
   - Open your browser to: http://localhost:8051

3. **View logs:**
   ```bash
   docker-compose logs -f
   ```

4. **Stop the game:**
   ```bash
   docker-compose down
   ```

## Manual Docker Commands

### Build the Image
```bash
docker build -t tank-battle:latest .
```

### Run the Container
```bash
docker run -d \
  --name tank-battle \
  -p 8051:8051 \
  --restart unless-stopped \
  tank-battle:latest
```

### View Logs
```bash
docker logs -f tank-battle
```

### Stop and Remove Container
```bash
docker stop tank-battle
docker rm tank-battle
```

## Configuration

### Change Port
Edit `docker-compose.yml`:
```yaml
ports:
  - "YOUR_PORT:8051"  # Change YOUR_PORT to desired port
```

Or for manual docker run:
```bash
docker run -d -p YOUR_PORT:8051 tank-battle:latest
```

## Production Deployment

### Using Environment Variables
```bash
docker run -d \
  --name tank-battle \
  -p 8051:8051 \
  -e FLASK_ENV=production \
  --restart unless-stopped \
  tank-battle:latest
```

### With Docker Compose
```bash
# Build and start in detached mode
docker-compose up -d --build

# Scale if needed (multiple instances)
docker-compose up -d --scale tank-battle=3
```

## Health Checks

The container includes automatic health checks:
- Check interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3
- Start period: 10 seconds

View health status:
```bash
docker ps
docker inspect tank-battle | grep -A 10 Health
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs tank-battle

# Check if port is already in use
netstat -tuln | grep 8051
lsof -i :8051
```

### Connection refused
```bash
# Verify container is running
docker ps

# Check if service is listening inside container
docker exec tank-battle netstat -tuln | grep 8051
```

### Rebuild after code changes
```bash
# With docker-compose
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# With docker
docker stop tank-battle
docker rm tank-battle
docker rmi tank-battle:latest
docker build -t tank-battle:latest .
docker run -d -p 8051:8051 --name tank-battle tank-battle:latest
```

## Resource Limits

### Set Memory and CPU Limits
Edit `docker-compose.yml`:
```yaml
services:
  tank-battle:
    # ... other config ...
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Networking

### Expose to External Network
1. Make sure your firewall allows port 8051
2. Access via: `http://YOUR_SERVER_IP:8051`

### Behind Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:8051;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Updates

### Update to Latest Code
```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

## Backup

### Backup Container State
```bash
# Commit container to image
docker commit tank-battle tank-battle-backup:$(date +%Y%m%d)

# Save image to tar
docker save tank-battle-backup:$(date +%Y%m%d) | gzip > tank-battle-backup.tar.gz
```

## Docker Hub (Optional)

### Tag and Push
```bash
# Tag image
docker tag tank-battle:latest yourusername/tank-battle:latest

# Push to Docker Hub
docker push yourusername/tank-battle:latest

# Pull on another server
docker pull yourusername/tank-battle:latest
docker run -d -p 8051:8051 yourusername/tank-battle:latest
```

## Support

For game-related issues, check:
- Game logs: `docker logs tank-battle`
- Server console output
- Browser console (F12)
