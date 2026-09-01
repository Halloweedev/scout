# Scout

**The open-source power tool for your files.**

Scout is a cross-platform power file manager for macOS, Windows, and Linux. It is built with a Rust core, Tauri 2, SolidJS, and TypeScript, with a local-first architecture and a keyboard-first interface.

The product direction is simple: **Finder familiarity + Arc-level refinement + Codex-level reduction.** Scout should remain recognizable as a file manager while removing friction and adding serious power-user capability.

## Principles

- Fast, local-first filesystem work.
- Familiar hierarchy and a permanent left sidebar.
- Tabs, navigation history, panes, workspaces, search, previews, utilities, and automation.
- Monochrome black/charcoal UI with custom SVG iconography and progressive disclosure.
- No SaaS dashboard patterns, decorative glass containers, blue accents, or unusual navigation metaphors.
- Free and open source for everyone, supported by voluntary donations.

## Current implementation

The repository now contains a functional M1 filesystem shell rather than a static mockup:

- Native Rust directory listing and platform special-directory discovery.
- Back/forward/up navigation with per-tab history.
- Multiple tabs.
- Keyboard and range selection.
- Copy, cut, paste, duplicate, inline rename, native trash, and folder creation.
- Internal drag/drop moves between folders.
- Hidden-file toggle.
- Custom contextual menu.
- Files open through the operating system's configured default application.

The next M1 work is filesystem watching, external OS drag/drop hardening, and the undo/redo operation foundation.

## Stack

- Rust
- Tauri 2
- SolidJS
- TypeScript
- Vite

## Development

Requirements: a current Node.js LTS release, pnpm, Rust, and the platform prerequisites for Tauri 2.

```bash
pnpm install
pnpm tauri dev
```

Frontend-only development:

```bash
pnpm dev
```

Type-check and build the frontend:

```bash
pnpm build
```

Rust check:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

See [ROADMAP.md](ROADMAP.md) for the milestone plan.

## License

Scout is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE.md](LICENSE.md).
