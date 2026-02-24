from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.expression import run_expression
from ...common.progress import progress_json_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    channel: Annotated[int, typer.Option("--channel")],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    run_expression(workspace, pos, channel, output, on_progress=progress_json_stderr)
