# lisca-desktop

Desktop UI for Lisca assay management and registration.

## Implemented scope

- Assays list backed by SQLite (`name`, `time`, `type`, `folder`)
- Assay actions flow (`Import YAML`, `Killing`, `Expression`)
- Info page writes `assay.yaml`
- Register page loads microscopy image, edits lattice controls, and saves `Pos{id}_bbox.csv`

## Data folder assumptions

- Position folders are named `Pos{N}`
- TIFF filenames follow `img_channel{C}_position{P}_time{T}_z{Z}.tif`
- `assay.yaml` lives at the selected data-folder root

## Development

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun install
bun run dev
```

## Build

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun run build
bun run pack
```

## Tests

```bash
cd C:/Users/ctyja/workspace/lisca/lisca-desktop
bun test
```
