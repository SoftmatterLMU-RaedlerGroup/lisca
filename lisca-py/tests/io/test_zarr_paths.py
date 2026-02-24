import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from lisca_py.io.zarr import bg_store_path, roi_store_path


def test_paths() -> None:
    ws = Path("/tmp/ws")
    assert roi_store_path(ws, 58).name == "Pos58_roi.zarr"
    assert bg_store_path(ws, 58).name == "Pos58_bg.zarr"
