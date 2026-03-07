from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.convert import run_convert
from ...common.progress import legacy_callback_adapter, progress_terminal_stderr


def command(
    input: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    pos: Annotated[str, typer.Option("--pos")],
    time: Annotated[str, typer.Option("--time")],
    output: Annotated[Path, typer.Option("--output")],
    no_progress: Annotated[bool, typer.Option("--no-progress")] = False,
) -> None:
    sink = None if no_progress else progress_terminal_stderr()
    run_convert(input, pos, time, output, on_progress=legacy_callback_adapter(sink))
