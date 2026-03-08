# Headful Browser - 安装和使用指南

## 架构说明

这个插件由两部分组成：

```
┌─────────────────────────────────────────────────────────────┐
│  你的开发机 / 构建机                                         │
│  ├── cockpit-headful-browser/                               │
│  │   ├── src/          ← TypeScript/React 源码             │
│  │   ├── package.json  ← npm 依赖                          │
│  │   └── build.js     ← 构建脚本                           │
│  │                                                         │
│  └── 构建产物 dist/    ← 只需复制到服务器                    │
└─────────────────────────────────────────────────────────────┘
                              │  rsync / scp
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Ubuntu 服务器                                               │
│  ├── /usr/share/cockpit/headful-browser/  ← 插件文件        │
│  │   ├── manifest.json                                     │
│  │   ├── index.html                                        │
│  │   └── index.js    ← 构建后的 React 应用                 │
│  │                                                         │
│  ├── headful-browser.service  ← systemd 服务               │
│  └── Chrome + XVFB + noVNC  ← 依赖包                        │
└─────────────────────────────────────────────────────────────┘
```

## 安装步骤

### 第一步：构建插件（在你的开发机上）

```bash
# 1. 进入插件目录
cd cockpit-headful-browser

# 2. 安装 Node 依赖
npm install

# 3. 构建（生成 dist/ 目录）
make build

# 4. 确认 dist/ 目录已生成
ls dist/
# 应该看到: index.html  index.js  manifest.json  index.css
```

### 第二步：部署到服务器

**方式 A：直接复制（简单）**

```bash
# 在开发机上执行
scp -r dist/ user@your-server:/tmp/headful-browser-plugin/

# SSH 到服务器
ssh user@your-server

# 复制到 Cockpit 目录
sudo mkdir -p /usr/share/cockpit/headful-browser
sudo cp -r /tmp/headful-browser-plugin/* /usr/share/cockpit/headful-browser/

# 重启 Cockpit
sudo systemctl restart cockpit
```

**方式 B：Makefile（推荐，带 rsync）**

```bash
# 在开发机上，直接部署到远程服务器
RSYNC=your-server make watch

# 或者一次性部署
rsync -avz dist/ your-server:/usr/share/cockpit/headful-browser/
ssh your-server "sudo systemctl restart cockpit"
```

### 第三步：服务器上安装依赖并安装服务

在**包含 `service/` 目录的项目根目录**下执行（例如上传了完整项目或 clone 的仓库）：

```bash
# SSH 到服务器
ssh your-server

# 进入项目目录（必须包含 service/setup.sh 和 service/headful-browser.service）
cd /path/to/cockpit-headful-browser   # 或你上传的目录

# 运行自动安装脚本（会安装依赖、创建用户、安装 systemd 服务文件）
sudo ./service/setup.sh
```

这个脚本会自动：
- 安装 Chrome/Chromium、XVFB、x11-utils、Fluxbox、X11VNC、noVNC、ImageMagick
- 创建 `headful-browser` 用户及目录（含 `/var/log/headful-browser`）
- 配置 sudo 权限
- **将 service 文件复制到 `/etc/systemd/system/` 并替换为实际 Chrome 路径**
- 执行 `systemctl daemon-reload`

**或者手动安装：**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y xvfb x11-utils fluxbox x11vnc websockify novnc imagemagick

# 安装 Chrome
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google.list
sudo apt update
sudo apt install -y google-chrome-stable

# 创建用户
sudo useradd -r -m -s /bin/false -d /var/lib/headful-browser headful-browser
sudo mkdir -p /var/lib/headful-browser/.config/chrome-profile

# 配置 sudo
sudo tee /etc/sudoers.d/headful-browser << 'EOF'
ALL ALL=(root) NOPASSWD: /bin/systemctl * headful-browser
ALL ALL=(root) NOPASSWD: /usr/bin/journalctl -u headful-browser
EOF
sudo chmod 440 /etc/sudoers.d/headful-browser
```

### 第四步：验证并启动服务

（服务文件已由 setup.sh 安装，此处仅需验证与启动。）

```bash
# 验证服务配置（会执行全部检查后再退出，便于排查）
sudo ./service/verify.sh

# 启动服务（若尚未启动）
sudo systemctl start headful-browser

# 可选：设置开机启动
sudo systemctl enable headful-browser
```

**说明**：若手动安装依赖（未运行 setup.sh），需自行将 `service/headful-browser.service` 复制到 `/etc/systemd/system/` 并执行 `sudo systemctl daemon-reload`，且需创建 `/var/log/headful-browser` 并 `chown headful-browser:headful-browser`。

### 服务进程管理说明

`headful-browser.service` 使用以下机制确保进程正确管理：

```
启动流程:
ExecStartPre → 清理旧进程 → 启动 Xvfb → 启动 Fluxbox → 启动 x11vnc → 启动 websockify
                                    ↓
ExecStart → Chrome (主进程, 被 systemd 直接跟踪)

停止流程:
systemctl stop → 发送 SIGTERM 给 Chrome → ExecStopPost 清理脚本
                                   ↓
                     1. 读取 PID 文件优雅停止辅助进程
                     2. 等待 2 秒
                     3. 强制杀死残留进程 (按用户筛选)
                     4. 清理锁文件
```

**关键特性：**
- `Type=exec` - systemd 直接使用 execve() 启动 Chrome，确保正确跟踪
- `KillMode=process` - 只杀死主进程，让 ExecStopPost 处理清理
- PID 文件 - 每个辅助进程都有 PID 文件，用于精确停止
- 用户隔离 - 所有进程以 `headful-browser` 用户运行，清理时不会误杀其他用户进程
- 超时控制 - `TimeoutStopSec=15` 确保服务在 15 秒内停止

### 验证服务状态

```bash
# 运行验证脚本
sudo ./service/verify.sh

# 手动检查各组件
sudo systemctl status headful-browser
sudo pgrep -u headful-browser -a  # 查看所有进程
sudo netstat -tlnp | grep -E '5900|6900|9222'  # 查看端口
```

---

## 🚀 日常使用

### 方式 1：通过 Cockpit Web 界面（推荐）

1. **打开 Cockpit**
   ```
   https://your-server:9090
   ```

2. **找到插件**
   - 左侧导航栏 → **"Remote Browser"**

3. **启动浏览器**
   - 点击 **"Start"** 按钮
   - 等待状态变成绿色 "Running"

4. **查看画面**
   - 页面中间的 VNC 区域会显示 Chrome 窗口
   - 可以直接点击操作浏览器

5. **截图**
   - 点击 **"Screenshot"** 按钮
   - 截图会显示在页面下方

6. **停止**
   - 点击 **"Stop"** 按钮关闭浏览器

### 方式 2：命令行（SSH）

```bash
# 启动浏览器服务
sudo systemctl start headful-browser

# 检查状态
sudo systemctl status headful-browser

# 查看日志
sudo journalctl -u headful-browser -f

# 停止
sudo systemctl stop headful-browser
```

### 方式 3：与小红书脚本结合

```bash
# SSH 到服务器
ssh your-server

# 设置显示（关键！）
export DISPLAY=:99

# 现在可以运行任何需要 GUI 的程序
cd /path/to/xiaohongshu-skills

# 运行登录（画面会显示在 Cockpit VNC 中）
uv run scripts/cli.py login

# 或者分步登录
uv run scripts/cli.py send-code --phone 13800138000
# 在 Cockpit 中观察画面，然后在 SSH 中输入验证码
uv run scripts/cli.py verify-code --code 123456
```

---

## 📊 常用命令速查

| 操作 | Cockpit | 命令行 |
|------|---------|--------|
| 启动 | 点击 Start | `sudo systemctl start headful-browser` |
| 停止 | 点击 Stop | `sudo systemctl stop headful-browser` |
| 重启 | 点击 Restart | `sudo systemctl restart headful-browser` |
| 查看状态 | 看状态标签 | `sudo systemctl status headful-browser` |
| 看日志 | 页面下方 | `sudo journalctl -u headful-browser -f` |
| 截图 | 点击 Screenshot | `DISPLAY=:99 import -window root screenshot.png` |

---

## 🔧 故障排查

### 插件不显示

```bash
# 检查文件是否存在
ls /usr/share/cockpit/headful-browser/

# 检查 manifest.json 语法
python3 -m json.tool /usr/share/cockpit/headful-browser/manifest.json

# 重启 Cockpit
sudo systemctl restart cockpit
```

### 服务启动失败

```bash
# 查看详细错误
sudo journalctl -u headful-browser -n 50 --no-pager

# 检查依赖是否安装
which google-chrome
which Xvfb
which x11vnc

# 手动测试 Chrome
sudo -u headful-browser google-chrome --version
```

### VNC 画面不显示

```bash
# 检查端口
sudo netstat -tlnp | grep 6900

# 手动测试 noVNC
curl http://localhost:6900

# 检查防火墙
sudo ufw status | grep 6900
```

### 服务停止时进程残留

如果 `systemctl stop` 后还有进程残留：

```bash
# 1. 检查残留进程
sudo pgrep -u headful-browser -a

# 2. 强制清理（服务自带清理，但可手动执行）
sudo pkill -9 -u headful-browser

# 3. 检查是否有僵尸进程
ps aux | grep defunct

# 4. 清理锁文件
sudo rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# 5. 重新启动
sudo systemctl restart headful-browser

# 6. 验证清理成功
sudo ./service/verify.sh
```

**预防措施：**
- 服务使用 `ExecStopPost` 自动清理
- PID 文件精确跟踪辅助进程
- 用户隔离避免误杀
- 15 秒超时强制终止

### Chrome 启动失败

```bash
# 检查 Chrome 是否能找到显示器
sudo -u headful-browser DISPLAY=:99 google-chrome --version

# 查看 Chrome 启动日志
sudo journalctl -u headful-browser -n 50

# 检查端口冲突
sudo netstat -tlnp | grep 9222

# 手动测试（调试用）
sudo -u headful-browser DISPLAY=:99 google-chrome --remote-debugging-port=9222 --app="about:blank"
```

### 显示问题

```bash
# 检查 XVFB 是否创建显示
sudo -u headful-browser xdpyinfo -display :99

# 检查 X 权限
ls -la /tmp/.X11-unix/

# 检查服务日志（Xvfb、fluxbox、x11vnc、websockify）
tail /var/log/headful-browser/xvfb.log
```

---

## 🔄 更新插件

```bash
# 1. 开发机重新构建
cd cockpit-headful-browser
make build

# 2. 重新部署到服务器
rsync -avz dist/ your-server:/usr/share/cockpit/headful-browser/
ssh your-server "sudo systemctl restart cockpit"
```

---

## 🗂️ 文件路径汇总

| 用途 | 路径 |
|------|------|
| 插件文件 | `/usr/share/cockpit/headful-browser/` |
| 服务文件 | `/etc/systemd/system/headful-browser.service` |
| Chrome 配置 | `/var/lib/headful-browser/.config/chrome-profile/` |
| 服务日志（Xvfb 等） | `/var/log/headful-browser/` |
| 临时截图 | `/tmp/headful-browser/` |
| systemd 日志 | `sudo journalctl -u headful-browser` |
