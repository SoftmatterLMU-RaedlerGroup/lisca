from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.convert import run_convert
from ...common.progress import progress_json_stderr


def command(
    input: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    pos: Annotated[str, typer.Option("--pos")],
    time: Annotated[str, typer.Option("--time")],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    run_convert(input, pos, time, output, on_progress=progress_json_stderr)
