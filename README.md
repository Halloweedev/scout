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

## Status

Scout is being rebuilt from the repository up. The first implementation target is M1: a dependable daily-driver filesystem with real directory listing, navigation, file operations, selection, context menus, tabs, hidden files, drag/drop, and filesystem watching.

See [ROADMAP.md](ROADMAP.md) for the milestone plan.

## License

Scout is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE.md](LICENSE.md).
