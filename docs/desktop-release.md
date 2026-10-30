# Learning Studio desktop releases

The release pipeline supports Windows x64 and explicitly targets [dhanusharavinda/PROJECT_LEARNING_STUDIO](https://github.com/dhanusharavinda/PROJECT_LEARNING_STUDIO). The existing application ID, product name and user-data directory are preserved.

## Update behavior

Settings provides three separate actions: **Check for updates**, **Download**, and **Restart and install**. Optional automatic checks run at startup and every 24 hours. Neither checking nor an ordinary app quit installs anything. Failed checks and downloads remain retryable.

Restart first saves pending Lab edits, then checks active teaching, background jobs, imports, compaction and Lab runs. A failed draft save or busy/unreachable server refuses installation while retaining the downloaded update. Synchronous server work reservations prevent new work from starting between the idle check and shutdown. A prepared restart lock expires after 30 seconds if abandoned; active server work has no expiry. Browser Lab work uses its bounded run lease.

The shell waits for the updater's native handoff confirmation. If the updater refuses installation or never confirms it, the shell recreates its local server and provider connections and permits another attempt. A failed server recovery explicitly asks the user to close and reopen Learning Studio. Ordinary quitting still never installs a staged update.

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

## Host-safe updater rehearsal

A profile override and NSIS `/D` are insufficient to isolate a production installer. NSIS can find an earlier installation through the product registry key, and process cleanup can use the product executable name. Do not test the production installer beside a running personal installation of that identity.

The local rehearsal scripts instead package the same Electron updater source and frozen standalone server under `com.synapse.learningstudio.updatetest`, product and executable `Learning Studio Update Test`, package name `learning-studio-update-test`, and a separate fixed NSIS GUID. These identifiers separate installation registration, process targeting, profile and updater cache. The rehearsal disables shortcuts and elevation. It preserves the assisted NSIS install and relaunch mechanism.

After a successful standalone build, run:

```powershell
node scripts/build-update-rehearsal.mjs --freeze
node scripts/build-update-rehearsal.mjs --build
./scripts/install-update-rehearsal.ps1
./scripts/install-update-rehearsal.ps1 -Install
node scripts/serve-update-rehearsal.mjs
```

The build stops unless the actual NSIS compiler definitions use the isolated identity. It verifies both packaged identities, unchanged updater source, separate cache and installer bytes against the manifests. The install script checks namespace collisions and records the personal application's process/file snapshot before and after. It seeds only synthetic lesson and non-secret provider preferences in the separate test profile. It does not launch or close any personal app. Artifacts and receipts live under `work/updater-proof` and are not release assets.

Launch the installed test executable with `LH_UPDATE_FEED=http://127.0.0.1:18767/`, `LH_IGNORE_ENV_KEYS=1`, and `--remote-debugging-port=18768` only for the local verification run. `node scripts/verify-update-rehearsal.mjs download` drives the actual Settings Check and Download buttons. The `restart` phase clicks Restart and install. Complete the isolated NSIS finish screen, then verify the new installed shell version and byte-identical synthetic data. The `verify` phase requires the isolated renderer's debugger connection. If relaunch drops the debugging argument, record the real relaunched process first, then reopen only the test app with that argument for inspection. Never infer the new shell version from the renderer's compiled version label: both test installers reuse the same frozen web build.

A completed rehearsal proves the updater and NSIS mechanism with an isolated product identity. It does not claim an installation into the user's production identity.

For the 0.5.0 preparation, both isolated installers passed compiler-identity and asset checks, and the initial isolated installation completed with unchanged production application files. Automated app launch was rejected by approval review, so the real Settings Check, Download, and Restart flow and preserved data after an upgrade remain unverified. Later handoff-recovery hardening passed unit tests but was not exercised by that initial installer. These limits must accompany the release verification report.

For a separate real GitHub feed check, `build-production-update-check.mjs` creates only an unpacked production-identity shell with a lower test version. Its `upgradeCheckOnly` package marker requires a dedicated marked profile, prepared by `prepare-production-update-check.mjs`. Supply the generated `LH_UPGRADE_TEST_MODE=check-download-only` and absolute `LH_UPGRADE_TEST_PROFILE`, and clear inherited `LH_DEV_URL`, `LH_UPDATE_FEED`, and `ELECTRON_RUN_AS_NODE`. The production updater can check/download the published asset, but the main process always refuses installation in this profile. The updater cache is isolated, signing policy is preserved, and provider environment keys are ignored. Do not use real credentials or personal data for either test.
