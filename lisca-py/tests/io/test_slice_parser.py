import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from lisca_py.common.slices import parse_slice_string


def test_parse_slice_string() -> None:
    assert parse_slice_string("all", 4) == [0, 1, 2, 3]
    assert parse_slice_string("0:4:2", 5) == [0, 2]
