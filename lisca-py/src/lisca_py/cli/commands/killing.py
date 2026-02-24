from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.killing import run_killing_predict
from ...common.progress import progress_json_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    model: Annotated[str, typer.Option("--model")],
    output: Annotated[Path, typer.Option("--output")],
    batch_size: Annotated[int, typer.Option("--batch-size")] = 256,
    cpu: Annotated[bool, typer.Option("--cpu")] = False,
) -> None:
    run_killing_predict(workspace, pos, model, output, batch_size=batch_size, cpu=cpu, on_progress=progress_json_stderr)
