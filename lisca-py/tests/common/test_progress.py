import io

from lisca_py.common.progress import (
    ProgressEvent,
    ProgressKind,
    TerminalProgressRenderer,
    legacy_callback_adapter,
    progress_event,
)


class CaptureStream(io.StringIO):
    def __init__(self, *, interactive: bool) -> None:
        super().__init__()
        self._interactive = interactive

    def isatty(self) -> bool:
        return self._interactive


def test_legacy_callback_adapter_emits_update_event() -> None:
    events: list[ProgressEvent] = []
    callback = legacy_callback_adapter(events.append)

    assert callback is not None
    callback(0.4, "Processing")

    assert events == [
        ProgressEvent(
            kind=ProgressKind.UPDATE,
            progress=0.4,
            message="Processing",
            step=None,
            current=None,
            total=None,
            timestamp=events[0].timestamp,
        )
    ]


def test_terminal_renderer_interactive_writes_progress_bar() -> None:
    stream = CaptureStream(interactive=True)
    renderer = TerminalProgressRenderer(stream, interactive=True)

    renderer(progress_event(0.5, "Working"))
    renderer(progress_event(1.0, "Done", kind=ProgressKind.FINISH))

    output = stream.getvalue()
    assert "\r" in output
    assert "50%" in output
    assert "Done" in output
    assert output.endswith("\n")


def test_terminal_renderer_noninteractive_writes_plain_text() -> None:
    stream = CaptureStream(interactive=False)
    renderer = TerminalProgressRenderer(stream, interactive=False)

    renderer(progress_event(0.0, "Starting", kind=ProgressKind.START))
    renderer(progress_event(1.0, "Done", kind=ProgressKind.FINISH))

    output = stream.getvalue()
    assert "start" in output
    assert "finish" in output
    assert "{" not in output
