from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.movie import run_movie
from ...common.progress import progress_json_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    roi: Annotated[int, typer.Option("--roi")],
    channel: Annotated[int, typer.Option("--channel")],
    time: Annotated[str, typer.Option("--time")],
    output: Annotated[Path, typer.Option("--output")],
    fps: Annotated[int, typer.Option("--fps")] = 10,
    colormap: Annotated[str, typer.Option("--colormap")] = "grayscale",
    spots: Annotated[Path | None, typer.Option("--spots", exists=True, dir_okay=False)] = None,
) -> None:
    run_movie(workspace, pos, roi, channel, time, output, fps, colormap, spots, on_progress=progress_json_stderr)
