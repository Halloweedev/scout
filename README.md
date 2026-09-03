# Scout

**The open-source power tool for your files.**

Scout is a local-first, cross-platform power file manager for macOS, Windows, and Linux. It combines familiar file-manager navigation with multi-pane workflows, fast previews, search, utilities, an operation queue, automation, and developer-aware file workflows.

Scout is built with **Rust + Tauri 2 + SolidJS + TypeScript**. Files stay on your machine unless you explicitly use an external tool yourself.

## Current status

The M1–M7 implementation baseline is complete and the repository is maintained as a production candidate. Every push to `main` type-checks/builds the frontend, runs Rust checks and tests on macOS/Windows/Linux, builds installable packages, and launches the real Linux desktop app through an automated runtime smoke test.

### Daily-driver filesystem

- Native directory browsing with fast first paint and background metadata hydration.
- Back / forward / parent navigation and editable location entry (`Cmd/Ctrl+L`).
- Tabs with independent history, folder bookmarks, and 1–4 explorer panes.
- Linked pane navigation and persistent workspaces.
- Icons, List, Miller Columns, and Gallery views with per-folder view preferences and Adaptive View.
- Multi-selection, rubber-band selection, spatial keyboard navigation, inline rename, copy/cut/paste, duplicate, create folder, native Trash, and drag/drop.
- Direct tab reordering, spring-loaded folder drops, explicit move/copy drag intent, and invalid-drop protection.
- Native filesystem watching with debounced refresh.
- Cross-platform special locations and mounted-drive discovery.

### Search, actions, and previews

- Persistent SQLite-backed fuzzy file index with usage, recency, and path-aware ranking.
- Search 2.0 with deep indexed search, bounded local content search, and saved searches.
- Shared Actions Registry plus `Cmd/Ctrl+K` Command Palette with contextual availability and usage-aware ranking.
- Inspector with previews, metadata, tags, location, and registry-backed quick actions.
- Quick Look for folders, images + EXIF, text/code, rendered Markdown, PDFs, audio, video, and ZIP archives.
- Lazy image thumbnails with bounded concurrency and memory.

### Power tools

- Batch rename, SHA-256 checksums, File Health, exact duplicate detection, similar-photo search, and folder-size treemap.
- ZIP create/extract, Smart Extract, and read-only archive browsing.
- Native image resize/convert/optimize and PDF operations.
- Quick conversion recipes plus user-defined custom actions.
- Optional FFmpeg, Pandoc, and LibreOffice conversions when those tools are installed locally.
- Portal shelf, Scout tags + Tag Smart Collections, symlink tools, IDE launchers, and Open Terminal Here.

### Operations and automation

- Shared persistent Operations queue with foreground/background priority, bounded concurrency, progress, cancellation, and failure states.
- Compact live Operations HUD.
- Persistent Footprints operation history plus undo/redo for reversible filesystem actions.
- Persisted Hazel-style rules with dry runs, live filesystem triggers, loop suppression, and actions for move/copy/rename/tag/convert/optimize/archive/program execution.
- Scout-native cross-platform tags.

### Developer-aware files

- Automatic Git repository detection without changing normal non-Git browsing.
- Ambient `M` / `A` / `?` / `!` file state, nested-change folder hints, and branch/change context in explorer panes.
- Branch, upstream, ahead/behind, staged, modified, untracked, and conflict state.
- Git Status panel plus working-tree and staged diff inspection.
- Context-aware Stage, Unstage, Diff, and Discard actions through the shared Actions Registry and file context menus.
- Direct Git subprocess argument vectors rather than shell command strings.

Scout is intentionally developer-aware rather than a full Git client. Commit authoring, history visualization, remotes, pull requests, and hosting-service workflows are outside the current baseline.

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
- Automation and Git program actions launch argument vectors directly rather than evaluating shell strings.

## License

Scout is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE.md](LICENSE.md).
