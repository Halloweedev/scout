# Scout

**The open-source power tool for your files.**

Scout is a local-first, cross-platform power file manager for macOS, Windows, and Linux. It combines familiar file-manager navigation with multi-pane workflows, fast previews, search, utilities, an operation queue, and Hazel-style automation.

Scout is built with **Rust + Tauri 2 + SolidJS + TypeScript**. Files stay on your machine unless you explicitly use an external tool yourself.

## Current status

The M1–M5 implementation baseline is complete and the repository is maintained as a production candidate. Every push to `main` type-checks/builds the frontend, runs Rust checks and tests on macOS/Windows/Linux, builds installable packages, and launches the real Linux desktop app through an automated runtime smoke test.

### Daily-driver filesystem

- Native directory browsing with fast first paint and background metadata hydration.
- Back / forward / parent navigation and editable location entry (`Cmd/Ctrl+L`).
- Tabs with independent history, folder bookmarks, and 1–4 explorer panes.
- Linked pane navigation and persistent workspaces.
- Icons, List, Miller Columns, and Gallery views.
- Multi-selection, rubber-band selection, keyboard navigation, inline rename, copy/cut/paste, duplicate, create folder, native Trash, and drag/drop.
- Native filesystem watching with debounced refresh.
- Cross-platform special locations and mounted-drive discovery.

### Search and previews

- Persistent SQLite-backed fuzzy file index with usage, recency, and path-aware ranking.
- Bounded local content search and saved searches.
- Quick Look for folders, images + EXIF, text/code, rendered Markdown, PDFs, audio, video, and ZIP archives.
- Lazy image thumbnails with bounded concurrency and memory.

### Power tools

- Batch rename, SHA-256 checksums, exact duplicate detection, similar-photo search, and folder-size treemap.
- ZIP create/extract and read-only archive browsing.
- Native image resize/convert/optimize and PDF operations.
- Optional FFmpeg, Pandoc, and LibreOffice conversions when those tools are installed locally.
- Portal shelf and Open Terminal Here.

### Operations and automation

- Shared persistent Operations queue with progress, cancellation, failure states, and bounded history.
- Footprints operation history plus undo/redo for reversible filesystem actions.
- Persisted Hazel-style rules with dry runs, live filesystem triggers, loop suppression, and actions for move/copy/rename/tag/convert/optimize/archive/program execution.
- Scout-native cross-platform tags.

See [ROADMAP.md](ROADMAP.md) for the completed milestone checklist and remaining intentional limitations.

## Development

Requirements: a current Node.js release, pnpm, Rust stable, and the platform prerequisites for Tauri 2.

```bash
pnpm install
pnpm tauri dev
```

Frontend-only development:

```bash
pnpm dev
```

Production checks:

```bash
pnpm build
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

## Releases

Scout's release workflow builds `.dmg`, `.exe` (NSIS), and `.deb` installers from version tags. Repository versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` must match the tag.

Supported tags:

```text
vX.Y.Z-alpha.N
vX.Y.Z-beta.N
vX.Y.Z
```

The Linux release executable is launched and exercised before a candidate or GitHub release is accepted. macOS/Windows trusted public distribution additionally requires the appropriate platform signing/notarization credentials to be configured by the distributor.

## Security

- Local-only frontend assets with an explicit Tauri Content Security Policy.
- No remote script/CDN dependencies in the desktop webview.
- Native commands are capability-scoped to the Scout desktop window.
- Automation program actions launch argument vectors directly rather than evaluating shell strings.

## License

Scout is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE.md](LICENSE.md).
