# Changelog

## Unreleased

### Security
- Harden reaction inbound handling with per-sender authorization and rate limiting.
- Guard first-DM owner binding against stale concurrent owner snapshots.
- Restrict configure-hook writes to an allowlist of safe runtime keys with correct casing.
- Redact signed URL query strings from download logs, repair internal-token permissions, validate outbound voice URLs, and pin DNS resolutions during media downloads.

### Added
- Add operator doctor diagnostics and the `scripts/admin.js` management CLI.
- Add `dmPolicy: "pairing"` for owner-approved unknown DMs, plus first-contact DM welcome messages.
- Send a user-visible Zalo notice when C4 delivery finally fails.
- Add voice, sticker, and link send prefixes through `scripts/send.js`.
- Add public directory resolver admin commands for friend/group lookup.
- Add inbound per-sender rate limiting, session-expiry owner/admin alerts, per-thread C4 dispatch serialization, and inbound read-status auto-trigger support.
- Surface inbound Zalo recall/delete-for-everyone events to C4 through the `undo` listener.
- Transcribe inbound voice messages when a safe Zalo voice URL and transcription provider are available.
- Add opt-in per-group `allowedActions` policies for `/internal/send` group actions.
- Preserve basic Markdown emphasis and list styling when sending text via Zalo native text styles.

### Fixed
- Add runtime guards for missing or malformed inbound data, message cache records, and internal service payloads.

## [0.1.2] - 2026-05-28

### Fixed
- QR code file never saved to disk when using callback-based loginQR — zca-js does not auto-save when a callback is provided; added explicit `event.actions.saveToFile(qrPath)` call in the QRCodeGenerated handler. This caused `/internal/qr` to always return 404, making dashboard QR generation time out.

## [0.1.1] - 2026-05-26

### Security
- Harden inbound download URL validation: HTTPS-only, Zalo CDN allowlist, private IP rejection, redirect validation
- Timing-safe internal token comparison (replaces plain string equality)
- Tighten outbound attachment path policy: restrict to component media dir, realpath containment, regular-file + size checks, remove broad /tmp allowance

### Fixed
- Clean up typing/thinking indicators on C4 delivery failure (no more stale reactions)
- Add TTL sweep for pendingThinking entries (5-minute expiry)
- Add age-based messageCache eviction (10-minute TTL)

### Changed
- Directory creation uses explicit 0o700 permissions (media, typing, sessions, staging)
- Config writes preserve 0o600 file mode
- SKILL.md: read receipts marked as internal API only, message delete capability removed

### Added (post-0.1.0, pre-hardening)
- Thinking indicator (thumbs-up reaction on receive, cleared on reply)
- Bot mention stripping (@bot UID-based, name-independent)
- Group hardening and smart/mention mode support
- Media cleanup and log rotation
- WebSocket health monitoring and keep-alive

## [0.1.0] - 2026-05-20

- Initial release
- zca-js integration for personal Zalo account
- DM and group message support
- File/image/sticker send and receive
- Reactions support
- Typing indicators
- QR code authentication
- Session persistence
- C4 bridge integration
- Access control (DM + group policies)
