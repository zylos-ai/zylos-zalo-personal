# zylos-zalo-personal

Zalo personal account communication channel for Zylos Agent (unofficial, via zca-js).

Uses a real Zalo account instead of the official Bot Platform API. Unlocks capabilities the Bot Platform cannot provide: group chats, file send/receive, reactions, typing indicators, mentions, and friend/group management.

## Requirements

- Node.js >= 20
- Zalo mobile app (for QR code authentication)
- Active Zalo account

## Installation

```bash
zylos add zylos-ai/zylos-zalo-personal
```

## Authentication

On first start, the service generates a QR code at `sessions/qr.png`. Scan it with your Zalo mobile app to authenticate. Credentials are saved and reused on subsequent starts.

**Note:** Only one web session can be active at a time. Running this service prevents simultaneous use of Zalo Web in a browser.

## Configuration

Config file: `~/zylos/components/zalo-personal/config.json`

```json
{
  "enabled": true,
  "dmPolicy": "owner",
  "dmAllowFrom": [],
  "groupPolicy": "allowlist",
  "groups": {},
  "features": {
    "download_media": true,
    "max_download_mb": 50
  },
  "message": {
    "context_messages": 5,
    "textMode": "plain"
  },
  "internal_port": 3463
}
```

### Access Control

- **dmPolicy**: `"owner"` (only owner), `"allowlist"` (owner + dmAllowFrom), `"open"` (anyone)
- **groupPolicy**: `"allowlist"` (only registered groups), `"open"` (all groups), `"disabled"` (no groups)
- **Group modes**: `"mention"` (respond only when @mentioned) or `"smart"` (observe all, respond selectively)

### Group Auto-Registration

When the owner @mentions the bot in an unregistered group, it is automatically registered with `mode: "mention"` and `allowFrom: ["*"]`.

## Capabilities

| Feature | Supported |
|---------|-----------|
| Text messages (DM + group) | Yes |
| Images (send/receive) | Yes |
| Files (send/receive) | Yes |
| Stickers (send/receive) | Yes |
| Reactions (6 types) | Yes |
| Quote-reply | Yes |
| Read receipts | Internal API only |
| Delivery receipts | Internal API only |
| Typing indicators | Yes |
| Link previews | Yes |
| Group mention/smart modes | Yes |
| Voice messages | Send only (requires hosted URL) |

## Security

- **CDN-only media downloads**: Only images from known Zalo CDN hosts (zadn.vn, zdn.vn, dlfl.vn, zaloapp.com) are downloaded. All other URLs are blocked.
- **SSRF protection**: Private IP ranges (IPv4 and IPv6) are blocked for all outbound requests.
- **Fail-closed config**: If config.json is missing or corrupted after initial setup, the service refuses to start rather than resetting to defaults.
- **Automatic cleanup**: Media files older than 7 days and logs over 5MB are rotated automatically.

## Important Caveats

- **Unofficial API**: zca-js is a reverse-engineered headless Zalo Web client, not an official API. Zalo can change internal APIs at any time and break this channel without notice.
- **Account risk**: Using unofficial automation may violate Zalo's Terms of Service and could result in account restrictions.
- **Session management**: Requires hourly cookie refresh (handled automatically). QR re-login needed if session expires.

## Service

```bash
pm2 start ecosystem.config.cjs    # Start
pm2 logs zylos-zalo-personal       # View logs
pm2 restart zylos-zalo-personal    # Restart
```

## License

MIT
