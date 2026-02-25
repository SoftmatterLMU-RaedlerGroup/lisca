from pathlib import Path
import subprocess


def test_root_help() -> None:
    out = subprocess.run(["uv", "run", "lisca-py", "--help"], cwd=Path(__file__).resolve().parents[2], check=True, capture_output=True, text=True)
    for command in ["convert", "crop", "register", "movie", "expression", "killing", "tissue"]:
        assert command in out.stdout


def test_subcommand_help() -> None:
    root = Path(__file__).resolve().parents[2]
    subcommands = {
        "convert": "--input",
        "crop": "--bbox",
        "register": "--grid",
        "movie": "--fps",
        "expression": "--channel",
        "killing": "--model",
        "tissue": "--method",
    }
    for command, expected_flag in subcommands.items():
        out = subprocess.run(["uv", "run", "lisca-py", command, "--help"], cwd=root, check=True, capture_output=True, text=True)
        assert expected_flag in out.stdout
