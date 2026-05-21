---
name: zalo-personal
version: 0.1.0
description: >-
  Zalo personal account communication channel (unofficial, via zca-js).
  Uses a real Zalo account instead of the official Bot Platform API.
  Supports: text, images, files, stickers, reactions, groups, typing indicators.
  Use when: (1) replying to Zalo personal messages (DM or group),
  (2) sending proactive messages or files to Zalo users or groups,
  (3) managing DM access control (dmPolicy: open/allowlist/owner, dmAllowFrom list),
  (4) managing group access control (groupPolicy, per-group allowFrom),
  (5) troubleshooting Zalo personal connection or QR login issues.
  Config at ~/zylos/components/zalo-personal/config.json. Service: pm2 zylos-zalo-personal.
type: communication

lifecycle:
  npm: true
  service:
    type: pm2
    name: zylos-zalo-personal
    entry: src/index.js
  data_dir: ~/zylos/components/zalo-personal
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - logs/
    - sessions/

upgrade:
  repo: zylos-ai/zylos-zalo-personal
  branch: main

config:
  required: []
  optional: []

dependencies:
  - comm-bridge
---

# Zalo Personal

Zalo personal account messaging component using zca-js (unofficial Zalo Web API).

**WARNING:** This uses an unofficial, reverse-engineered API. Risks include:
- Account banning (violates Zalo ToS)
- API breakage when Zalo updates their web client
- Single web session (Zalo Web in browser disconnects the bot)

## Authentication

QR code login required. On first start, the service generates a QR code URL.
Scan it with the Zalo mobile app to authenticate. Session persists across restarts
via saved credentials in `~/zylos/components/zalo-personal/sessions/`.

## Capabilities (vs Bot Platform)

| Feature | Bot Platform | Personal |
|---------|-------------|----------|
| Text | Yes | Yes |
| Images | Send URL only | Send/receive files |
| Files/PDFs | No | Yes |
| Stickers | Yes | Yes |
| Groups | No | Full support |
| Reactions | No | 11 emoji types |
| Typing | Basic | Yes |
| Read receipts | No | Yes |
| Message delete | No | Yes |
| Mentions | No | Yes |

## Sending Messages

Via C4 Bridge:
```bash
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo-personal" "<user_id>"
message
EOF
```

## Group Modes

Each group has a `mode` setting (default: `mention`):

| Mode | Behavior | Media downloads |
|------|----------|----------------|
| `mention` | Only forward messages that @mention the bot | Download when @mentioned |
| `smart` | Forward ALL messages to Claude | Metadata-only unless @mentioned |

Smart mode sends a `<smart-mode>` hint so Claude knows to only respond when appropriate.
Smart mode without @mention skips typing indicators and media downloads (sends `[image, url: ...]` or `[file: name]` metadata instead).

Config example:
```json
"groups": {
  "123456": {
    "name": "Team Chat",
    "mode": "smart",
    "allowFrom": ["*"]
  }
}
```

## Config Location

- Config: `~/zylos/components/zalo-personal/config.json`
- Sessions: `~/zylos/components/zalo-personal/sessions/`
- Logs: `~/zylos/components/zalo-personal/logs/`

## Service Management

```bash
pm2 status zylos-zalo-personal
pm2 logs zylos-zalo-personal
pm2 restart zylos-zalo-personal
```
