from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    x: int
    y: int
    w: int
    h: int


@dataclass(frozen=True)
class ExpressionRow:
    t: int
    crop: int
    intensity: int
    area: int
    background: int


@dataclass(frozen=True)
class KillingRow:
    t: int
    crop: int
    label: bool


@dataclass(frozen=True)
class TissueRow:
    t: int
    crop: int
    cell: int
    total_fluorescence: float
    cell_area: int
    background: int
