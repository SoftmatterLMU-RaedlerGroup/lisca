# lisca

Phase 1 CLI-first merge of PyAMA + mupattern.

## Layout

- `core/spec/` canonical contracts (`zarr-layout-v1.md`, `cli-contract-v1.md`)
- `lisca-py/` Python CLI backend (`lisca-py`)
- `lisca-rs/` Rust desktop-facing CLI (`lisca-rs` binary)
- `lisca-py/tests/` Python schema tests
- `lisca-rs/tests/` Rust CLI tests

## Commands

Both CLIs expose the same subcommands:

- `convert`
- `crop`
- `movie`
- `expression`
- `killing`
- `tissue`

## Data stores

Hard switch to per-position stores:

- `Pos{id}_roi.zarr`
- `Pos{id}_bg.zarr`

Legacy `crops.zarr` is unsupported.

## Local dev

Python (`lisca-py`):

```bash
cd lisca-py
uv run lisca-py --help
```

Rust (`lisca-rs`):

```bash
cd lisca-rs
cargo run -- --help
```

Rust execution is native in `lisca-rs`:

```bash
cargo run -- crop ...
```

The `movie` command spawns `ffmpeg` as an external process for rendering output.
