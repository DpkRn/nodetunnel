# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing unreleased yet.

## [1.0.10] - 2026-04-12

### Changed

- Expanded README with clearer coverage of what nodetunnel does and how to use it.

## [1.0.9] - 2026-04-12

### Added

- Makefile with `pkg` (publish) and `test` targets for maintainers.
- Contributor Covenant Code of Conduct.
- Local traffic inspector: HTTP UI plus WebSocket streaming of request/response logs (via `ws`).
- Structured logging store for tunneled HTTP exchanges.

### Changed

- Refactor of the published tunnel package layout and dependencies.
- Clearer logging during tunnel setup and while forwarding requests.

## [1.0.8] - 2026-04-12

### Changed

- Maintenance release (version alignment).

## [1.0.7] - 2026-04-12

### Changed

- Default tunnel server host set to `clickly.cv`.
- Public URL string returned by the tunnel client updated for consistency with the server.
- Tunnel handshake and messaging updated (connection UUID and success-line formatting for the assigned URL).

## [1.0.4] - 2026-04-03

### Added

- Node.js tunnel library: expose a local HTTP server through a gotunnel/yamux-compatible remote (`startTunnel` and related APIs).

## [1.0.2] - 2026-04-03

### Added

- Initial `@dpkrn/nodetunnel` package scaffold.

[Unreleased]: https://github.com/DpkRn/nodetunnel/compare/v1.0.10...HEAD
[1.0.10]: https://github.com/DpkRn/nodetunnel/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/DpkRn/nodetunnel/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/DpkRn/nodetunnel/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/DpkRn/nodetunnel/compare/v1.0.4...v1.0.7
[1.0.4]: https://github.com/DpkRn/nodetunnel/compare/v1.0.2...v1.0.4
[1.0.2]: https://github.com/DpkRn/nodetunnel/releases/tag/v1.0.2
