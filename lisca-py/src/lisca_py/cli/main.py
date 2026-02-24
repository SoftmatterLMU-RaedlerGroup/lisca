"""Lisca CLI."""

from __future__ import annotations

import typer

from .commands import convert, crop, expression, killing, movie, tissue

app = typer.Typer(add_completion=False, help="lisca-py CLI: convert, crop, movie, expression, killing, tissue")

app.command("convert")(convert.command)
app.command("crop")(crop.command)
app.command("movie")(movie.command)
app.command("expression")(expression.command)
app.command("killing")(killing.command)
app.command("tissue")(tissue.command)

if __name__ == "__main__":
    app()
