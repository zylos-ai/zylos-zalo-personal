# Changelog

## [0.1.4] - 2026-06-03

### Added
- Notify the bound owner directly on Zalo when an unknown DM user enters `dmPolicy: "pairing"`, while preserving the existing C4 admin notification and requester reply.
- Allow the owner to approve or deny pending DM pairing requests in-chat with exact `approve` / `deny` commands, using `approve <user_id>` or `deny <user_id>` when multiple requests are pending.
- Keep the admin CLI pairing commands as a fallback path.

## [0.1.3] - 2026-06-02

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
- Clean up voice temp files, stale media trees, timestamp caches, and oversized logs without deleting C4-dispatched media before async delivery.
- Preserve sibling nested config defaults during partial overrides and default outbound text mode to Markdown with `message.textMode: "plain"` as the opt-out.
- Queue reaction forwarding per thread, use consistent group-name resolution, avoid duplicate reaction request IDs, and tighten owner/pairing edge cases.
- Remove low-risk unused code paths and consolidate safe correlation ID handling.

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
