# zylos-zalo-personal Design

## Architecture

Uses zca-js to automate a personal Zalo account via Zalo Web's reverse-engineered protocol.

```
Zalo Servers <--WebSocket--> zca-js (in-process) <--> C4 Bridge <--> Claude
```

## Authentication Flow

1. First run: QR code generated at sessions/qr.png
2. User scans with Zalo mobile app
3. Credentials saved to sessions/credentials.json
4. Subsequent runs: auto-login with saved credentials
5. If credentials expire: falls back to QR login

## Key Differences from zylos-zalo (Bot Platform)

| Feature | Bot Platform | Personal |
|---------|-------------|----------|
| Auth | Bot token (permanent) | QR login + session cookies |
| Groups | Not supported | Full support |
| Files | Not supported | Send + receive |
| Reactions | Not supported | 6 reaction types |
| Typing | sendChatAction | sendTypingEvent |
| API stability | Official, stable | Reverse-engineered, fragile |

## Send Architecture

send.js communicates with the running service via internal HTTP API (/internal/send)
because zca-js requires the active authenticated WebSocket session to send messages.

The internal send API accepts text, attachment, reaction, seen, delivered, link,
voice, sticker, directory lookup, group-info lookup, and sticker-search actions.
Group sends are fail-open by default; configure `groups[groupId].allowedActions`
to restrict actions for a specific group.

Text sends use Zalo native style ranges for basic Markdown in the v0.1.3 release
line, with `message.textMode: "plain"` as the opt-out. Style offsets are JS
string offsets, matching Zalo's UTF-16 code-unit basis.
