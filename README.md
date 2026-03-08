# Headful Browser - Cockpit Plugin

Run **headful Chrome/Chromium** on headless servers with remote VNC access via Cockpit.

Perfect for:
- Running browser automation on headless servers with visual feedback
- Remote debugging of web applications
- Web scraping with visible browser interactions
- E2E testing with live monitoring

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Your Browser                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Cockpit → "Remote Browser" Page                    │    │
│  │  ┌─────────────────────────────────────────────┐   │    │
│  │  │  noVNC WebSocket iframe                     │   │    │
│  │  │  ┌─────────────────────────────────────┐   │   │    │
│  │  │  │  Chrome on virtual display (:99)   │   │   │    │
│  │  │  │  (real browser, not headless)      │   │   │    │
│  │  │  └─────────────────────────────────────┘   │   │    │
│  │  └─────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────┐
│  Headless Server                                            │
│  ┌─────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   │
│  │  XVFB   │ → │  Chrome  │ ← │ x11vnc  │ ← │websockify│   │
│  │ :99     │   │ (headful)│   │ :5900   │   │ :6900    │   │
│  └─────────┘   └──────────┘   └─────────┘   └──────────┘   │
│                                                             │
│  systemd: headful-browser.service                          │
└─────────────────────────────────────────────────────────────┘
```

## Features

- 🖥️ **Virtual Display** - XVFB provides a virtual framebuffer for Chrome
- 🌐 **Web VNC** - Access browser via noVNC directly in Cockpit
- 📸 **Screenshots** - One-click capture of browser state
- 📊 **Status Monitoring** - Real-time service status indicators
- 📝 **Log Streaming** - Live journalctl logs in the UI
- ⚙️ **Remote Control** - Start/stop/restart browser from Cockpit

## Requirements

- **Cockpit** 264+ (`apt install cockpit`)
- **Node.js** 18+ (for building)
- **Chrome** or **Chromium**
- **XVFB**, **X11VNC**, **Websockify**, **Fluxbox**

## Quick Start

### 1. Install Dependencies

```bash
sudo ./service/setup.sh
```

This installs Chrome, XVFB, VNC server, and creates the `headful-browser` user.

### 2. Build the Plugin

```bash
npm install
make build
```

### 3. Install Plugin

```bash
sudo make install
```

### 4. Start Service

From Cockpit:
1. Open `https://your-server:9090`
2. Click "Remote Browser" in the sidebar
3. Click **Start**

Or via command line:
```bash
sudo systemctl start headful-browser
```

### 5. Use Chrome

The browser is now accessible:
- **Via Cockpit**: Click in the VNC area to interact
- **Via CDP**: `curl http://localhost:9222/json/version`
- **Set DISPLAY**: `export DISPLAY=:99` and run any X app

## Development

```bash
# Install dependencies
npm install

# Development mode (auto-rebuild)
make watch

# Or manual rebuild
make build

# Development install (symlink)
make devel-install

# Code linting
npm run eslint
npm run stylelint
```

## Usage with Automation

```bash
# Set display for CLI tools
export DISPLAY=:99

# Chrome is now running with visible UI
curl http://localhost:9222/json/version

# Use with Puppeteer/Playwright/etc
node automation-script.js
```

## Configuration

Edit `service/headful-browser.service`:

```ini
Environment="SCREEN_RES=1920x1080x24"  # Virtual display resolution
Environment="CHROME_PORT=9222"         # Chrome DevTools Protocol port
Environment="VNC_PORT=5900"            # VNC server port
Environment="NOVNC_PORT=6900"          # Web VNC port
```

Then reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart headful-browser
```

## File Locations

| Path | Description |
|------|-------------|
| `/usr/local/share/cockpit/headful-browser/` | Cockpit plugin files |
| `/usr/local/lib/headful-browser/` | Service scripts |
| `/var/lib/headful-browser/` | User home (Chrome profile, etc.) |
| `/tmp/headful-browser/` | Screenshots |

## Uninstall

```bash
sudo make devel-uninstall  # If using dev install
sudo rm -rf /usr/local/share/cockpit/headful-browser
sudo rm -rf /usr/local/lib/headful-browser
sudo rm -f /etc/systemd/system/headful-browser.service
sudo userdel -r headful-browser
```

## License

MIT
