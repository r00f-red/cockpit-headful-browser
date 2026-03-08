#!/bin/bash
# Verify Headful Browser service is working correctly
# Runs all checks and reports results; exits with 1 only if any check failed

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_pass() { echo -e "${GREEN}✓${NC} $1"; }
check_fail() { echo -e "${RED}✗${NC} $1"; }
check_warn() { echo -e "${YELLOW}⚠${NC} $1"; }

FAILED=0

echo "=== Headful Browser Service Verification ==="
echo ""

# Check if service is running
echo "1. Checking systemd service..."
if systemctl is-active --quiet headful-browser; then
    check_pass "Service is running"
    systemctl status headful-browser --no-pager -l
else
    check_fail "Service is not running"
    echo "   Run: sudo systemctl start headful-browser"
    FAILED=1
fi
echo ""

# Check processes
echo "2. Checking processes..."

if pgrep -u headful-browser -f "Xvfb :99" > /dev/null; then
    check_pass "Xvfb (virtual display) is running"
else
    check_fail "Xvfb is not running"
    FAILED=1
fi

if pgrep -u headful-browser -f "x11vnc.*5900" > /dev/null; then
    check_pass "x11vnc (VNC server) is running"
else
    check_fail "x11vnc is not running"
    FAILED=1
fi

if pgrep -u headful-browser -f "websockify.*6900" > /dev/null; then
    check_pass "websockify (noVNC) is running"
else
    check_fail "websockify is not running"
    FAILED=1
fi

if pgrep -u headful-browser -f "google-chrome\|chromium" > /dev/null; then
    check_pass "Chrome/Chromium is running"
else
    check_fail "Chrome/Chromium is not running"
    FAILED=1
fi
echo ""

# Check ports
echo "3. Checking network ports..."

if nc -z 127.0.0.1 5900 2>/dev/null; then
    check_pass "VNC port (5900) is accessible"
else
    check_fail "VNC port (5900) is not accessible"
    FAILED=1
fi

if nc -z 127.0.0.1 6900 2>/dev/null; then
    check_pass "noVNC port (6900) is accessible"
else
    check_fail "noVNC port (6900) is not accessible"
    FAILED=1
fi

if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    check_pass "Chrome CDP port (9222) is accessible"
    CHROME_VERSION=$(curl -s http://localhost:9222/json/version | grep -o '"Browser": "[^"]*"' | head -1)
    echo "   Version: $CHROME_VERSION"
else
    check_fail "Chrome CDP port (9222) is not accessible"
    FAILED=1
fi
echo ""

# Check display
echo "4. Checking virtual display..."
if sudo -u headful-browser DISPLAY=:99 xdpyinfo > /dev/null 2>&1; then
    check_pass "Display :99 is working"
    RES=$(sudo -u headful-browser DISPLAY=:99 xdpyinfo 2>/dev/null | grep dimensions | head -1 | awk '{print $2}')
    echo "   Resolution: $RES"
else
    check_fail "Display :99 is not accessible"
    FAILED=1
fi
echo ""

# Check noVNC web interface
echo "5. Checking noVNC web interface..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:6900 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "101" ]; then
    check_pass "noVNC web interface is accessible (HTTP $HTTP_CODE)"
else
    check_fail "noVNC web interface returned HTTP $HTTP_CODE"
    FAILED=1
fi
echo ""

# Check logs
echo "6. Recent logs..."
echo "---"
journalctl -u headful-browser -n 10 --no-pager 2>/dev/null || echo "No journal entries found"
echo "---"
echo ""

# Summary
echo "=== Summary ==="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All checks passed! Service is working correctly.${NC}"
    echo ""
    echo "Access: http://your-server:6900"
    echo "Cockpit: https://your-server:9090 -> Remote Browser"
    exit 0
else
    echo -e "${RED}Some checks failed. Please review the output above.${NC}"
    echo ""
    echo "Debug commands:"
    echo "  View logs:    sudo journalctl -u headful-browser -f"
    echo "  Service logs: ls -la /var/log/headful-browser/"
    echo "  Restart:      sudo systemctl restart headful-browser"
    echo "  Full status:  sudo systemctl status headful-browser"
    exit 1
fi
