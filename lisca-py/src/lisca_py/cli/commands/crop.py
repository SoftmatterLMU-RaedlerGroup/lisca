from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.crop import run_crop
from ...common.progress import legacy_callback_adapter, progress_terminal_stderr


def command(
    input: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    bbox: Annotated[Path, typer.Option("--bbox", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    background: Annotated[bool, typer.Option("--background/--no-background")] = False,
    no_progress: Annotated[bool, typer.Option("--no-progress")] = False,
) -> None:
    sink = None if no_progress else progress_terminal_stderr()
    run_crop(input, pos, bbox, output, background, on_progress=legacy_callback_adapter(sink))
