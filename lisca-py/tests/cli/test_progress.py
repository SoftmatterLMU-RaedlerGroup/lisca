from pathlib import Path

from typer.testing import CliRunner

from lisca_py.cli.commands import convert as convert_command
from lisca_py.cli.commands import register as register_command
from lisca_py.cli.main import app

runner = CliRunner(mix_stderr=False)


def test_register_cli_prints_summary_not_json(monkeypatch, tmp_path: Path) -> None:
    def fake_run_register(*, on_progress=None, **_kwargs):
        if on_progress is not None:
            on_progress(0.5, "Detecting grid points")
            on_progress(1.0, "Register fit complete")
        return {
            "shape": "square",
            "a": 50.0,
            "alpha": 90.0,
            "b": 50.0,
            "beta": 0.0,
            "w": 48.0,
            "h": 48.0,
            "dx": 2.5,
            "dy": -1.5,
        }

    monkeypatch.setattr(register_command, "run_register", fake_run_register)

    result = runner.invoke(
        app,
        ["register", "--input", str(tmp_path), "--pos", "0"],
        color=False,
    )

    assert result.exit_code == 0
    assert "shape:" in result.stdout
    assert '"shape"' not in result.stdout
    assert "Detecting grid points" in result.stderr
    assert '{"progress"' not in result.stderr


def test_convert_cli_no_progress_suppresses_renderer(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "input.nd2"
    input_path.write_text("placeholder", encoding="utf-8")
    output_path = tmp_path / "out"

    def fake_run_convert(_input, _pos, _time, _output, *, on_progress=None) -> None:
        assert on_progress is None

    monkeypatch.setattr(convert_command, "run_convert", fake_run_convert)

    result = runner.invoke(
        app,
        [
            "convert",
            "--input",
            str(input_path),
            "--pos",
            "0",
            "--time",
            "0",
            "--output",
            str(output_path),
            "--no-progress",
        ],
        color=False,
    )

    assert result.exit_code == 0
    assert result.stderr == ""
