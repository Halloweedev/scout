# Releasing Scout

Scout's release baseline is intentionally conservative: every candidate must compile, pass Rust tests, and produce an installable bundle on Linux, macOS, and Windows before it is shared.

## Continuous alpha gate

Every push and pull request runs `.github/workflows/ci.yml` with locked dependencies and produces debug installable bundles:

- Linux: `.deb`
- macOS: `.dmg`
- Windows: NSIS `.exe`

The workflow uses committed `pnpm-lock.yaml` and `src-tauri/Cargo.lock`; dependency drift must be an explicit repository change.

## Release candidates

Run **Release candidate** from GitHub Actions and provide a version label such as `0.1.0-alpha.1`. The workflow builds optimized release bundles on all three platforms and stores them as GitHub Actions artifacts for review.

Do not publish a public stable release from these artifacts until platform signing is configured and the resulting signed binaries have been smoke-tested on clean machines.

## Signing readiness

### macOS

Before public distribution, use a Developer ID Application certificate and notarize the final `.app`/`.dmg` with Apple. Keep certificate material and notarization credentials only in GitHub Actions secrets or an external signing service; never commit them to the repository.

Recommended secret set once the Apple account is ready:

- `APPLE_CERTIFICATE` — base64-encoded `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- notarization credentials using either an App Store Connect API key or an Apple ID app-specific password

### Windows

Before public distribution, sign the executable and installer with a trusted code-signing certificate. Prefer a hardware/cloud-backed certificate provider. Wire the provider through Tauri's Windows `signCommand` rather than storing a raw private key in the repository.

### Linux

The `.deb` artifact is suitable for alpha testing. Repository/package-manager signing can be added when Scout has an official package repository.

## Release checklist

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` together.
2. Confirm CI is green on Linux, macOS, Windows.
3. Build a release candidate through GitHub Actions.
4. Install each artifact on a clean machine/VM and smoke-test launch, filesystem navigation, copy/move/rename/trash, Quick Look, search, Operations, and undo/redo.
5. For public releases, verify platform signatures and macOS notarization before publishing.
6. Tag only the exact reviewed commit.
