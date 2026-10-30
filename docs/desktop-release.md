# Learning Studio desktop releases

The release pipeline supports Windows x64 and explicitly targets [dhanusharavinda/PROJECT_LEARNING_STUDIO](https://github.com/dhanusharavinda/PROJECT_LEARNING_STUDIO). The existing application ID, product name and user-data directory are preserved.

## Update behavior

Settings provides three separate actions: **Check for updates**, **Download**, and **Restart and install**. Optional automatic checks run at startup and every 24 hours. Neither checking nor an ordinary app quit installs anything. Failed checks and downloads remain retryable.

Restart first checks active teaching, background jobs, imports, compaction and Lab runs. A busy or unreachable server refuses installation while retaining the downloaded update. Synchronous server work reservations prevent new work from starting between the idle check and shutdown. A prepared restart lock expires after 30 seconds if abandoned; active server work has no expiry. Browser Lab work uses its bounded run lease.

All updater commands require a trusted desktop main frame. The readiness endpoint requires the desktop mode and per-launch capability. Development shells cannot update. The loopback HTTP override `LH_UPDATE_FEED` exists only for packaged upgrade drills. The default channel selects stable releases from this fork.

## Windows packaging

Use Python 3.14 with pip to prepare the bundled runtime:

```powershell
./scripts/setup-manimgx.ps1 -BuildPython (Get-Command python).Source
npm ci
npm run typecheck
npm test
npm run lint
npm run desktop:win
```

Packaging includes the standalone server, Electron shell, updater dependencies, portable ManimGX and attribution. The payload curator rejects personal data and credentials. Windows installers remain unsigned and publisher-signature verification is disabled, so Windows can display an unknown-publisher prompt. SHA512 integrity verification does not replace publisher signing.

## Release workflow

A manual Desktop release workflow produces artifacts only. A matching stable version tag, such as `v0.5.0`, runs quality gates, prepares one unpublished draft, packages Windows, checks the payload, uploads assets, and verifies the complete remote inventory. Publication remains an explicit action.

The Windows job installs Node 26 and Python 3.14, prepares portable ManimGX, runs native tests, builds and smoke-tests the standalone server, packages NSIS, and exercises the packaged executable. The packaged runtime import and attribution are checked. Authentication is confined to release operations.

A draft must contain exactly four files:

| File | Purpose |
|---|---|
| `Learning-Studio-<version>-x64-setup.exe` | Windows installer |
| `Learning-Studio-<version>-x64-setup.exe.blockmap` | Differential metadata |
| `latest.yml` | Stable updater manifest |
| `Learning-Studio-<version>-source.zip` | Exact tagged source |

The source archive comes from `git archive HEAD` and includes the original license, LearnHarness/ManimGX attribution, Pi attribution and runtime build recipe. Private-data and generated paths are rejected. Before upload, the workflow compares the manifest's SHA512 and size against actual installer bytes. The release verifier then checks draft identity, exact asset inventory, safe manifest filenames, sizes, versions and consistent hashes.

## Bootstrap and verification

An older installed build with no feed needs one manual installation of a feed-enabled build. Then verify a genuine older-to-newer installed upgrade: check, download, busy-work refusal, installation/relaunch, displayed version, preserved notebooks/settings and packaged rendering. A loopback drill tests installation separately from the real GitHub feed. Builds and unit tests alone do not prove an installed upgrade.

Do not publish an incomplete draft. Public releases must be downloadable without distributing a GitHub token inside the app. Preserve LearnHarness authorship and AGPL attribution in source and packaged notices.
