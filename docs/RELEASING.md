# Releasing Scout

Scout uses three public release channels built from the same codebase and the same cross-platform release pipeline.

## Release channels

| Channel | Tag format | GitHub status | Purpose |
| --- | --- | --- | --- |
| Alpha | `v0.1.0-alpha.1` | Pre-release | Early testing; features and UX may still change |
| Beta | `v0.1.0-beta.1` | Pre-release | Feature-frozen testing; focus on bugs, performance, and polish |
| Stable | `v0.1.0` | Release | Reviewed public release with no known release-blocking issues |

Every Alpha, Beta, and Stable release includes installable builds for:

- Linux: `.deb`
- macOS: `.dmg`
- Windows: NSIS `.exe`

## Continuous gate

Every push and pull request runs `.github/workflows/ci.yml` with locked dependencies. CI builds the frontend, runs Rust checks/tests, and produces debug installable bundles on Linux, macOS, and Windows.

The repository commits both `pnpm-lock.yaml` and `src-tauri/Cargo.lock`; dependency drift must be an explicit repository change.

## Release candidates

Before tagging a public Alpha, Beta, or Stable release, optionally run **Release candidate** from GitHub Actions. This workflow builds optimized `.deb`, `.dmg`, and `.exe` artifacts without creating a GitHub Release, which makes it the preferred smoke-test step.

## Publishing a release

Actual publishing is tag-driven. The **Publish release** workflow accepts only:

- `vX.Y.Z-alpha.N`
- `vX.Y.Z-beta.N`
- `vX.Y.Z`

The tag version must exactly match the version in all three manifests:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

When a valid tag is pushed, GitHub Actions automatically:

1. Validates the tag and manifest versions.
2. Runs locked Rust tests.
3. Builds optimized Linux, macOS, and Windows installers.
4. Creates the GitHub Release.
5. Attaches the `.deb`, `.dmg`, and `.exe` installers.
6. Generates release notes from GitHub history.
7. Marks Alpha/Beta builds as GitHub Pre-releases; stable versions are normal Releases.

Example progression:

```text
v0.1.0-alpha.1
v0.1.0-alpha.2
v0.1.0-beta.1
v0.1.0-beta.2
v0.1.0
v0.2.0-alpha.1
```

Do not maintain separate Alpha, Beta, and Stable branches. Keep `main` healthy and use reviewed commits plus version tags as release boundaries.

## Recommended release process

1. Decide the next version, for example `0.1.0-alpha.1`.
2. Update that exact version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Commit the version bump and confirm normal CI is green on Linux, macOS, and Windows.
4. Run the manual **Release candidate** workflow and install/smoke-test all three artifacts when the change is significant.
5. Test launch, filesystem navigation, copy/move/rename/trash, Quick Look, search, Operations, automation, and undo/redo.
6. Tag the exact reviewed commit, e.g. `v0.1.0-alpha.1`, and push the tag.
7. Let **Publish release** build and publish the GitHub Release automatically.
8. Verify the published installers before sharing the release broadly.

## Signing readiness

### macOS

Before broad public distribution, use a Developer ID Application certificate and notarize the final `.app`/`.dmg` with Apple. Keep certificate material and notarization credentials only in GitHub Actions secrets or an external signing service; never commit them to the repository.

Recommended secret set once the Apple account is ready:

- `APPLE_CERTIFICATE` — base64-encoded `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- notarization credentials using either an App Store Connect API key or an Apple ID app-specific password

### Windows

Before broad public distribution, sign the executable and installer with a trusted code-signing certificate. Prefer a hardware/cloud-backed certificate provider. Wire the provider through Tauri's Windows `signCommand` rather than storing a raw private key in the repository.

### Linux

The `.deb` artifact is suitable for Alpha/Beta distribution. Repository/package-manager signing can be added when Scout has an official package repository.

Until Apple and Windows signing are configured, Alpha/Beta releases can be used for testing, but stable releases should not be promoted broadly without clearly communicating the unsigned status.
