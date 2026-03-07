from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ...app.tissue import run_tissue
from ...common.progress import legacy_callback_adapter, progress_terminal_stderr


def command(
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    channel_phase: Annotated[int, typer.Option("--channel-phase")],
    channel_fluorescence: Annotated[int, typer.Option("--channel-fluorescence")],
    method: Annotated[str, typer.Option("--method")],
    model: Annotated[str, typer.Option("--model")],
    output: Annotated[Path, typer.Option("--output")],
    masks: Annotated[Path | None, typer.Option("--masks")] = None,
    no_progress: Annotated[bool, typer.Option("--no-progress")] = False,
) -> None:
    sink = None if no_progress else progress_terminal_stderr()
    run_tissue(
        workspace,
        pos,
        channel_phase,
        channel_fluorescence,
        method,
        model,
        output,
        masks,
        on_progress=legacy_callback_adapter(sink),
    )
