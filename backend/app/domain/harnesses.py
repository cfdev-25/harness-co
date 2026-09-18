import re
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.errors import ApiError

SIZE = 16
MAX_COLORS = 16
TRANSPARENT = "."
HEX_COLOR = re.compile(r"#[0-9a-f]{6}")


class Icon(BaseModel):
    """A pixel drawing: a palette, and one character per pixel.

    Rows are strings rather than nested arrays so the drawing is legible in
    the database, in an audit payload, and in a diff. `.` is transparent;
    every other character is a hex digit indexing the palette.
    """

    model_config = ConfigDict(extra="forbid")

    palette: list[str] = Field(default_factory=list, max_length=MAX_COLORS)
    rows: list[str] = Field(default_factory=lambda: [TRANSPARENT * SIZE] * SIZE)

    @field_validator("palette")
    @classmethod
    def _colors_are_hex(cls, value: list[str]) -> list[str]:
        for color in value:
            if not HEX_COLOR.fullmatch(color):
                raise ValueError(f"'{color}' is not a lower-case #rrggbb colour.")
        return value

    @model_validator(mode="after")
    def _rows_are_square_and_in_palette(self) -> "Icon":
        if len(self.rows) != SIZE:
            raise ValueError(f"A drawing needs exactly {SIZE} rows, not {len(self.rows)}.")
        allowed = set(TRANSPARENT) | {f"{index:x}" for index in range(len(self.palette))}
        for number, row in enumerate(self.rows):
            if len(row) != SIZE:
                raise ValueError(f"Row {number} has {len(row)} pixels; every row needs {SIZE}.")
            unknown = set(row) - allowed
            if unknown:
                raise ValueError(
                    f"Row {number} uses {sorted(unknown)[0]!r}, "
                    f"which is not '{TRANSPARENT}' or a colour in the palette."
                )
        return self


async def visible_harnesses(
    connection: asyncpg.Connection | asyncpg.Pool, org_unit_id: UUID
) -> list[dict[str, Any]]:
    """Every harness this org unit can pick: its own and its ancestors'.

    Names deliberately do not shadow. Two harnesses called "Support" at
    different heights are two harnesses, told apart by their owning unit — a
    harness is a workspace you choose, not a capability that overrides.
    """
    rows = await connection.fetch(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           )
           select h.*, u.path org_unit_path,
                  (select count(*) from harness_assets a where a.harness_id=h.id) assigned_assets
             from harnesses h
             join chain c on c.id=h.org_unit_id
             join org_units u on u.id=h.org_unit_id
            order by u.path, h.name""",
        org_unit_id,
    )
    return [dict(row) for row in rows]


async def visible_harness(
    connection: asyncpg.Connection | asyncpg.Pool, org_unit_id: UUID, harness_id: UUID
) -> dict[str, Any]:
    """One harness, if this org unit can see it. Invisible and absent are the
    same answer, so a harness id cannot be used to probe the tree."""
    row = await connection.fetchrow(
        """with recursive chain as (
             select id,parent_id from org_units where id=$1
             union all select p.id,p.parent_id from org_units p join chain c on c.parent_id=p.id
           )
           select h.*, u.path org_unit_path
             from harnesses h
             join chain c on c.id=h.org_unit_id
             join org_units u on u.id=h.org_unit_id
            where h.id=$2""",
        org_unit_id,
        harness_id,
    )
    if not row:
        raise ApiError(404, "harness_not_found", "This harness could not be found.")
    return dict(row)


async def assignments(
    connection: asyncpg.Connection | asyncpg.Pool, harness_id: UUID
) -> list[dict[str, Any]]:
    """What a harness contains, as (kind, name) pairs.

    This is the whole definition of a harness's contents. Which asset answers
    each name is resolution's business, and it differs per user, so it is
    never recorded here.
    """
    rows = await connection.fetch(
        "select kind, name from harness_assets where harness_id=$1 order by kind, name",
        harness_id,
    )
    return [{"kind": row["kind"], "name": row["name"]} for row in rows]
