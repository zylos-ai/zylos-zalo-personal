---
name: zalo-personal
version: 0.1.2
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

Depends on: comm-bridge (C4 message routing).

## Authentication

QR code login required. On first start, the service generates a QR code URL.
Scan it with the Zalo mobile app to authenticate. Session persists across restarts
via saved credentials in `~/zylos/components/zalo-personal/sessions/`.

Session requires hourly cookie refresh (handled automatically). QR re-login is
needed if the session expires or is invalidated.

## Sending Messages

Via C4 Bridge (always use stdin form):
```bash
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo-personal" "<user_id>"
message
EOF
```

Or directly (for testing):
```bash
node ~/zylos/.claude/skills/zalo-personal/scripts/send.js <user_id> "message"
```

## Media Messages

```bash
# Send image
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo-personal" "<user_id>"
[MEDIA:image]/path/to/photo.jpg
EOF

# Send file
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo-personal" "<user_id>"
[MEDIA:file]/path/to/document.pdf
EOF

# Send sticker
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo-personal" "<user_id>"
[MEDIA:sticker]<sticker_id>
EOF
```

Inbound images and files are downloaded automatically and forwarded to C4 as
file attachments. In smart mode without @mention, only metadata is forwarded
(`[image, url: ...]` or `[file: name]`).

## Capabilities (vs Bot Platform)

| Feature | Bot Platform | Personal |
|---------|-------------|----------|
| Text | Yes | Yes |
| Images | Send URL only | Send/receive files |
| Files/PDFs | No | Yes |
| Stickers | Yes | Yes |
| Groups | No | Full support |
| Reactions | No | 6 types |
| Typing | Basic | Yes |
| Read receipts | No | Internal API only |
| Mentions | No | Yes |
| Quote-reply | No | Yes |

## Config Location

- Config: `~/zylos/components/zalo-personal/config.json`
- Sessions: `~/zylos/components/zalo-personal/sessions/`
- Logs: `~/zylos/components/zalo-personal/logs/`

## Service Management

```bash
pm2 status zylos-zalo-personal    # Check status
pm2 logs zylos-zalo-personal      # View logs
pm2 restart zylos-zalo-personal   # Restart service
```

## Owner

First user to send a private message becomes the owner.
Owner bypasses DM policy and per-group allowlist checks. However,
`groupPolicy: disabled` blocks all group messages, including from the owner.

When the owner @mentions the bot in an unregistered group, it is automatically
registered with `mode: "mention"` and `allowFrom: ["*"]`.

## Access Control

DM and group access are controlled by independent policies:

```json
{
  "dmPolicy": "owner",
  "dmAllowFrom": ["user_id_1"],
  "groupPolicy": "allowlist",
  "groups": { ... }
}
```

**Private DM (dmPolicy):**
1. Owner? → always allowed
2. `dmPolicy` = `open`? → anyone can DM
3. `dmPolicy` = `owner`? → only owner can DM
4. `dmPolicy` = `allowlist`? → check `dmAllowFrom` list; not in list → dropped

**Group message (groupPolicy):**
1. `groupPolicy` = `disabled`? → all group messages dropped (including owner)
2. `groupPolicy` = `open`? → respond from any group
3. `groupPolicy` = `allowlist`? → only configured groups
4. Per-group `allowFrom` set? → only listed senders pass (owner always bypasses)
5. `allowFrom: ["*"]` → all group members allowed

**Key points:**
- Owner bypasses allowlist checks only; `groupPolicy: disabled` blocks all group messages, including from owner
- `dmPolicy` and `groupPolicy` are fully independent — changing one never affects the other
- No user-level whitelist for groups; use per-group `allowFrom` to restrict senders

## Group Modes

Each group has a `mode` setting:

| Mode | Behavior | Media downloads |
|------|----------|----------------|
| `mention` (default) | Only forward messages that @mention the bot | Download when @mentioned |
| `smart` | Forward ALL messages to Claude | Metadata-only unless @mentioned |

Smart mode sends a `<smart-mode>` hint so Claude knows to only respond when
appropriate. Smart mode without @mention skips typing indicators and media
downloads (sends metadata instead).

### Groups Config Format

Groups are stored in a map keyed by group id:

```json
{
  "groupPolicy": "allowlist",
  "groups": {
    "123456": {
      "name": "Team Chat",
      "mode": "smart",
      "allowFrom": ["*"],
      "added_at": "2026-01-01T00:00:00Z"
    }
  }
}
```

- `mode`: `"mention"` (respond to @mentions only) or `"smart"` (receive all messages)
- `allowFrom`: List of user IDs. `["*"]` = all group members allowed.
