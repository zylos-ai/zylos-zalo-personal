<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-zalo-personal</h1>

> **Zylos** (/ˈzaɪ.lɒs/ 赛洛丝) — Give your AI a life

<p align="center">
  Zalo personal account messaging component for <a href="https://github.com/zylos-ai/zylos-core">Zylos</a> agents.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://discord.gg/GS2J39EGff"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/ZylosAI"><img src="https://img.shields.io/badge/X-follow-000000?logo=x&logoColor=white" alt="X"></a>
  <a href="https://zylos.ai"><img src="https://img.shields.io/badge/website-zylos.ai-blue" alt="Website"></a>
  <a href="https://coco.xyz"><img src="https://img.shields.io/badge/Built%20by-Coco-orange" alt="Built by Coco"></a>
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
</p>

---

- **Chat on Zalo** — your AI agent uses a real Zalo account, supporting private and group conversations
- **Rich media** — send and receive images, files, stickers, reactions, and typing indicators
- **Smart group monitoring** — automatically follow designated group discussions, no @mention needed
- **Zero-config start** — first message auto-binds you as owner, no setup wizards
- **QR code login** — scan once with Zalo mobile, session persists across restarts

> **Note:** This component uses [zca-js](https://github.com/nicejom/zca-js), an unofficial reverse-engineered Zalo Web client — not the official Bot Platform API. See [Important Caveats](#important-caveats) below.

## Getting Started

Tell your Zylos agent:

> "Install the zalo-personal component"

Or use the CLI:

```bash
zylos add zylos-ai/zylos-zalo-personal
```

On first start, the service generates a QR code. Scan it with your Zalo mobile app to authenticate. Once connected, message the account on Zalo — the first user to interact becomes the owner.

## Managing the Bot

Just tell your Zylos agent what you need:

| Task | Example |
|------|---------|
| Add user to allowlist | "Add user xxx to zalo-personal allowlist" |
| Enable smart group | "Set this group to smart mode in zalo-personal" |
| Change DM policy | "Set zalo-personal DM policy to open" |
| Check status | "Show zalo-personal bot status" |
| Restart bot | "Restart zalo-personal" |
| Upgrade | "Upgrade zalo-personal component" |
| Uninstall | "Uninstall zalo-personal component" |

Or manage via CLI:

```bash
zylos upgrade zalo-personal
zylos uninstall zalo-personal
```

## Group Chat Behavior

| Scenario | Bot Response |
|----------|--------------|
| Private chat (owner/allowlisted) | Responds via Claude |
| Smart group message | Receives all messages |
| @mention in allowed group | Responds with context |
| Owner @mention in unregistered group | Auto-registers group |
| `groupPolicy: disabled` | All group messages blocked |
| Unknown user | Ignored |

## Important Caveats

> **Use at your own risk.** This component uses an unofficial API and may result in your Zalo account being restricted or permanently banned. We are not responsible for any account actions taken by Zalo.

- **Unofficial API** — zca-js is a reverse-engineered headless Zalo Web client. Zalo can change internal APIs at any time and break this channel without notice.
- **Account ban risk** — Using unofficial automation violates Zalo's Terms of Service. Your account may be temporarily restricted or permanently banned without warning. Use a secondary account if possible — do not risk your primary account.
- **Single web session** — Only one Zalo Web session can be active at a time. Running this service disconnects Zalo Web in your browser.

## Documentation

- [SKILL.md](./SKILL.md) — Component specification
- [DESIGN.md](./DESIGN.md) — Architecture and design
- [CHANGELOG.md](./CHANGELOG.md) — Version history

## Contributing

See [Contributing Guide](https://github.com/zylos-ai/.github/blob/main/CONTRIBUTING.md).

## Built by Coco

Zylos is the open-source core of [Coco](https://coco.xyz/) — the AI employee platform.

We built Zylos because we needed it ourselves: reliable infrastructure to keep AI agents running 24/7 on real work. Every component is battle-tested in production at Coco, serving teams that depend on their AI employees every day.

Want a managed experience? [Coco](https://coco.xyz/) gives you a ready-to-work AI employee — persistent memory, multi-channel communication, and skill packages — deployed in 5 minutes.

## License

[MIT](./LICENSE)
