from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

import typer

from ...app.register import run_register
from ...common.progress import legacy_callback_adapter, progress_terminal_stderr


def _format_number(value: object) -> str:
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.6f}".rstrip("0").rstrip(".")
    return str(value)


def format_register_summary(result: dict[str, object], *, pretty: bool = False) -> str:
    label_width = 14 if pretty else 0

    def line(label: str, value: object) -> str:
        if pretty:
            return f"{label:<{label_width}} {value}"
        return f"{label}: {value}"

    lines = [
        line("shape", result.get("shape", "")),
        line("a", _format_number(result.get("a", ""))),
        line("alpha", _format_number(result.get("alpha", ""))),
        line("b", _format_number(result.get("b", ""))),
        line("beta", _format_number(result.get("beta", ""))),
        line("w", _format_number(result.get("w", ""))),
        line("h", _format_number(result.get("h", ""))),
        line("dx", _format_number(result.get("dx", ""))),
        line("dy", _format_number(result.get("dy", ""))),
    ]

    diagnostics = result.get("diagnostics")
    if isinstance(diagnostics, dict) and diagnostics:
        if pretty:
            lines.append("")
            lines.append("diagnostics")
        for key in ("detected_points", "inlier_points", "initial_mse", "final_mse"):
            if key in diagnostics:
                label = key if not pretty else f"  {key}"
                lines.append(line(label, _format_number(diagnostics[key])))

    return "\n".join(lines)


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
    sink = None if no_progress else progress_terminal_stderr()
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
        on_progress=legacy_callback_adapter(sink),
    )
    print(format_register_summary(result, pretty=pretty))
