# Changelog

## 0.1.1 (2026-05-21)

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

## 0.1.0 (2026-05-20)

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
