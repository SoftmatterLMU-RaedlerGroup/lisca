import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from lisca_py.app.crop import run_crop
from lisca_py.app.expression import run_expression
from lisca_py.tests_helpers import write_bbox, write_fixture_tiffs


def test_expression_smoke(tmp_path: Path) -> None:
    write_fixture_tiffs(tmp_path)
    bbox = tmp_path / "bbox.csv"
    write_bbox(bbox)
    run_crop(tmp_path, 58, bbox, tmp_path, background=True)
    out = tmp_path / "expression.csv"
    run_expression(tmp_path, 58, 1, out)
    assert out.exists()
