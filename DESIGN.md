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
| Reactions | Not supported | 11+ emoji types |
| Typing | sendChatAction | sendTypingEvent |
| API stability | Official, stable | Reverse-engineered, fragile |

## Send Architecture

send.js communicates with the running service via internal HTTP API (/internal/send)
because zca-js requires the active authenticated WebSocket session to send messages.
