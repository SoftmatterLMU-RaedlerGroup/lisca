from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.tissue import run_tissue
from ...common.progress import progress_json_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    channel_phase: Annotated[int, typer.Option("--channel-phase")],
    channel_fluorescence: Annotated[int, typer.Option("--channel-fluorescence")],
    method: Annotated[str, typer.Option("--method")],
    model: Annotated[str, typer.Option("--model")],
    output: Annotated[Path, typer.Option("--output")],
    masks: Annotated[Path | None, typer.Option("--masks")] = None,
) -> None:
    run_tissue(
        workspace,
        pos,
        channel_phase,
        channel_fluorescence,
        method,
        model,
        output,
        masks,
        on_progress=progress_json_stderr,
    )
