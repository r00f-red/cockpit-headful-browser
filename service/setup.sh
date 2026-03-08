#!/bin/bash
# Setup script for Headful Browser
# Run this on the target server to install dependencies and configure the service

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
    error "Please run with sudo"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    error "Cannot detect OS"
    exit 1
fi

log "Installing dependencies for $OS..."

case $OS in
    ubuntu|debian)
        apt-get update
        apt-get install -y xvfb x11-utils fluxbox x11vnc websockify novnc imagemagick
        # Try Chrome first, then Chromium
        if ! apt-get install -y google-chrome-stable 2>/dev/null; then
            apt-get install -y chromium-browser || apt-get install -y chromium
        fi
        ;;
    fedora|rhel|centos|rocky|almalinux)
        dnf install -y xorg-x11-server-Xvfb xorg-x11-utils fluxbox x11vnc websockify novnc ImageMagick
        dnf install -y google-chrome-stable 2>/dev/null || dnf install -y chromium
        ;;
    *)
        error "Unsupported OS: $OS"
        exit 1
        ;;
esac

# Create user
if ! id "headful-browser" &>/dev/null; then
    log "Creating headful-browser user..."
    useradd -r -m -s /bin/false -d /var/lib/headful-browser headful-browser
fi

# Create directories
mkdir -p /var/lib/headful-browser/.config/chrome-profile
mkdir -p /tmp/headful-browser
mkdir -p /var/log/headful-browser
chown -R headful-browser:headful-browser /var/lib/headful-browser
chown headful-browser:headful-browser /var/log/headful-browser

# Configure sudo for Cockpit access
cat > /etc/sudoers.d/headful-browser << 'EOF'
# Headful Browser - Service management from Cockpit
ALL ALL=(root) NOPASSWD: /bin/systemctl start headful-browser
ALL ALL=(root) NOPASSWD: /bin/systemctl stop headful-browser
ALL ALL=(root) NOPASSWD: /bin/systemctl restart headful-browser
ALL ALL=(root) NOPASSWD: /bin/systemctl status headful-browser
ALL ALL=(root) NOPASSWD: /usr/bin/journalctl -u headful-browser
EOF
chmod 440 /etc/sudoers.d/headful-browser

# Find Chrome
CHROME_BIN=$(which google-chrome 2>/dev/null || which google-chrome-stable 2>/dev/null || which chromium 2>/dev/null || which chromium-browser 2>/dev/null)

if [ -z "$CHROME_BIN" ]; then
    error "Chrome/Chromium not found"
    exit 1
fi

log "Found browser: $CHROME_BIN"

# Copy service file (from same directory as this script) and update Chrome path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="$SCRIPT_DIR/headful-browser.service"
if [ ! -f "$SERVICE_SRC" ]; then
    error "Service file not found: $SERVICE_SRC"
    exit 1
fi
cp "$SERVICE_SRC" /etc/systemd/system/headful-browser.service
sed -i "s|/usr/bin/google-chrome|$CHROME_BIN|g" /etc/systemd/system/headful-browser.service

# Reload systemd
systemctl daemon-reload

log "Setup complete!"
log "Next steps:"
log "  1. Deploy the Cockpit plugin to /usr/share/cockpit/headful-browser/"
log "  2. Start the service: sudo systemctl start headful-browser"
log "  3. Open Cockpit and click 'Remote Browser' in the menu"
