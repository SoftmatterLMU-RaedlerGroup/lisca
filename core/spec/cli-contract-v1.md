# Lisca CLI Contract v1

Command names:

- `lisca-py` (Python)
- `lisca-rs` (Rust)

## Subcommands

- `convert`
- `crop`
- `movie`
- `expression`
- `killing`
- `tissue`

## Arguments

1. `lisca-py convert --input <nd2> --pos <slice> --time <slice> --output <workspace>`
2. `lisca-py crop --input <workspace_or_pos_dir> --pos <id> --bbox <csv> --output <workspace> [--background]`
3. `lisca-py movie --workspace <workspace> --pos <id> --roi <id> --channel <id> --time <slice> --output <mp4> --fps <int> --colormap <name> [--spots <csv>]`
4. `lisca-py expression --workspace <workspace> --pos <id> --channel <id> --output <csv>`
5. `lisca-py killing --workspace <workspace> --pos <id> --model <path> --output <csv> [--batch-size <n>] [--cpu]`
6. `lisca-py tissue --workspace <workspace> --pos <id> --channel-phase <id> --channel-fluorescence <id> --method <cellpose|cellsam> --model <path> --output <csv> [--masks <path>]`

## Rust subprocess progress contract

Rust emits newline-delimited JSON to `stderr`:

```json
{"progress": 0.42, "message": "Processing ..."}
```

Exit `0` on success, nonzero on failure.
