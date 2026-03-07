# lisca-desktop

Desktop UI for Lisca assay management and registration.

## Implemented scope

- Assays list backed by SQLite (`name`, `time`, `type`, `folder`)
- Assay actions flow (`Import YAML`, `Killing`, `Expression`)
- Info page writes `assay.yaml`
- Register page loads microscopy image, edits lattice controls, and saves `Pos{id}_bbox.csv`

`lisca-desktop` now uses Tauri with an in-process Rust bridge to call `lisca-rs` directly.
Windows builds bundle `ffmpeg.exe` as a Tauri sidecar, and the settings modal only downloads model files.

## Data folder assumptions

- Position folders are named `Pos{N}`
- TIFF filenames follow `img_channel{C}_position{P}_time{T}_z{Z}.tif`
- `assay.yaml` lives at the selected data-folder root

## Development

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun install
bun run build:rs
bun run dev
```

## Tauri (in-process Rust integration)

`lisca-rs` is available as a local Rust dependency in `lisca-desktop/src-tauri/Cargo.toml`:

```toml
lisca-rs = { path = "../lisca-rs" }
```

Use the `dev:tauri` / `build:tauri` scripts to run Tauri with in-process Rust command calls.

## Build

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun run build
bun run pack
```

Packaging is handled by Tauri and produces a single installer.

## Tests

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun test
```
