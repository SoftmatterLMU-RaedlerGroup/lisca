from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.expression import run_expression
from ...common.progress import legacy_callback_adapter, progress_terminal_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    channel: Annotated[int, typer.Option("--channel")],
    output: Annotated[Path, typer.Option("--output")],
    no_progress: Annotated[bool, typer.Option("--no-progress")] = False,
) -> None:
    sink = None if no_progress else progress_terminal_stderr()
    run_expression(workspace, pos, channel, output, on_progress=legacy_callback_adapter(sink))
