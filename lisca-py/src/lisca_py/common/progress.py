from __future__ import annotations

import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Protocol, TextIO

ProgressCallback = Callable[[float, str], None]


class ProgressKind(StrEnum):
    START = "start"
    UPDATE = "update"
    FINISH = "finish"
    ERROR = "error"


@dataclass(slots=True)
class ProgressEvent:
    kind: ProgressKind
    progress: float
    message: str
    step: str | None = None
    current: int | None = None
    total: int | None = None
    timestamp: str = field(default_factory=lambda: progress_timestamp())


class ProgressSink(Protocol):
    def __call__(self, event: ProgressEvent, /) -> None: ...


def progress_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clamp_progress(progress: float) -> float:
    return max(0.0, min(1.0, progress))


def progress_event(
    progress: float,
    message: str,
    *,
    kind: ProgressKind = ProgressKind.UPDATE,
    step: str | None = None,
    current: int | None = None,
    total: int | None = None,
    timestamp: str | None = None,
) -> ProgressEvent:
    return ProgressEvent(
        kind=kind,
        progress=clamp_progress(progress),
        message=message,
        step=step,
        current=current,
        total=total,
        timestamp=timestamp or progress_timestamp(),
    )


def legacy_callback_adapter(sink: ProgressSink | None) -> ProgressCallback | None:
    if sink is None:
        return None

    def callback(progress: float, message: str) -> None:
        sink(progress_event(progress, message))

    return callback


class TerminalProgressRenderer:
    def __init__(
        self,
        stream: TextIO | None = None,
        *,
        interactive: bool | None = None,
        plain_interval: float = 0.25,
        bar_width: int = 28,
    ) -> None:
        self._stream = stream or sys.stderr
        isatty = getattr(self._stream, "isatty", None)
        self._interactive = interactive if interactive is not None else bool(callable(isatty) and isatty())
        self._plain_interval = plain_interval
        self._bar_width = bar_width
        self._last_line_length = 0
        self._last_plain_progress = -1.0
        self._last_plain_message = ""
        self._last_plain_at = 0.0

    def __call__(self, event: ProgressEvent) -> None:
        normalized = progress_event(
            event.progress,
            event.message,
            kind=event.kind,
            step=event.step,
            current=event.current,
            total=event.total,
            timestamp=event.timestamp,
        )
        if self._interactive:
            self._render_interactive(normalized)
            return
        self._render_plain(normalized)

    def _render_interactive(self, event: ProgressEvent) -> None:
        progress = clamp_progress(event.progress)
        filled = min(self._bar_width, int(round(progress * self._bar_width)))
        bar = "#" * filled + "-" * (self._bar_width - filled)
        percent = int(round(progress * 100))
        suffix = self._event_suffix(event)
        line = f"{percent:>3}% [{bar}] {event.message}{suffix}"
        padding = max(0, self._last_line_length - len(line))
        self._stream.write(f"\r{line}{' ' * padding}")
        self._stream.flush()
        terminal = event.kind in {ProgressKind.FINISH, ProgressKind.ERROR} or progress >= 1.0
        self._last_line_length = 0 if terminal else len(line)
        if terminal:
            self._stream.write("\n")
            self._stream.flush()

    def _render_plain(self, event: ProgressEvent) -> None:
        progress = clamp_progress(event.progress)
        now = time.monotonic()
        should_print = (
            event.kind in {ProgressKind.START, ProgressKind.FINISH, ProgressKind.ERROR}
            or event.message != self._last_plain_message
            or abs(progress - self._last_plain_progress) >= 0.05
            or now - self._last_plain_at >= self._plain_interval
        )
        if not should_print:
            return
        percent = int(round(progress * 100))
        suffix = self._event_suffix(event)
        self._stream.write(f"{event.kind.value:>6} {percent:>3}% {event.message}{suffix}\n")
        self._stream.flush()
        self._last_plain_message = event.message
        self._last_plain_progress = progress
        self._last_plain_at = now

    @staticmethod
    def _event_suffix(event: ProgressEvent) -> str:
        if event.current is not None and event.total is not None:
            return f" ({event.current}/{event.total})"
        if event.step:
            return f" [{event.step}]"
        return ""


def progress_terminal_stderr() -> ProgressSink:
    return TerminalProgressRenderer(sys.stderr)
