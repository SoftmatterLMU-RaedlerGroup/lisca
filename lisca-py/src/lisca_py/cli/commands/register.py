from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

import typer

from ...app.register import run_register
from ...common.progress import progress_json_stderr


def command(
    input: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    pos: Annotated[int, typer.Option("--pos")],
    channel: Annotated[int, typer.Option("--channel")] = 0,
    time: Annotated[int, typer.Option("--time")] = 0,
    z: Annotated[int, typer.Option("--z")] = 0,
    grid: Annotated[Literal["square", "hex"], typer.Option("--grid")] = "square",
    w: Annotated[float, typer.Option("--w")] = 50.0,
    h: Annotated[float, typer.Option("--h")] = 50.0,
    local_var_radius: Annotated[int, typer.Option("--local-var-radius")] = 5,
    morph_radius: Annotated[int, typer.Option("--morph-radius")] = 2,
    peak_merge_radius: Annotated[int, typer.Option("--peak-merge-radius")] = 10,
    peak_min_abs: Annotated[float, typer.Option("--peak-min-abs")] = 3.0,
    peak_min_ratio: Annotated[float, typer.Option("--peak-min-ratio")] = 0.1,
    peak_drop_max_frac: Annotated[float, typer.Option("--peak-drop-max-frac")] = 0.3,
    peak_cv_threshold: Annotated[float, typer.Option("--peak-cv-threshold")] = 0.2,
    inlier_frac: Annotated[float, typer.Option("--inlier-frac")] = 0.95,
    refine_iters: Annotated[int, typer.Option("--refine-iters")] = 50,
    diagnostics: Annotated[bool, typer.Option("--diagnostics")] = False,
    pretty: Annotated[bool, typer.Option("--pretty")] = False,
    no_progress: Annotated[bool, typer.Option("--no-progress")] = False,
) -> None:
    result = run_register(
        input_dir=input,
        pos=pos,
        channel=channel,
        time=time,
        z=z,
        grid=grid,
        w=w,
        h=h,
        local_var_radius=local_var_radius,
        morph_radius=morph_radius,
        peak_merge_radius=peak_merge_radius,
        peak_min_abs=peak_min_abs,
        peak_min_ratio=peak_min_ratio,
        peak_drop_max_frac=peak_drop_max_frac,
        peak_cv_threshold=peak_cv_threshold,
        inlier_frac=inlier_frac,
        refine_iters=refine_iters,
        diagnostics=diagnostics,
        on_progress=None if no_progress else progress_json_stderr,
    )
    print(json.dumps(result, indent=2 if pretty else None))
