from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.crop import run_crop
from ...common.progress import progress_json_stderr


def command(
    input: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    bbox: Annotated[Path, typer.Option("--bbox", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    background: Annotated[bool, typer.Option("--background/--no-background")] = False,
) -> None:
    run_crop(input, pos, bbox, output, background, on_progress=progress_json_stderr)
