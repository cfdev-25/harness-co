import pytest
from pydantic import ValidationError

from app.domain.harnesses import SIZE, Icon

BLANK = ["." * SIZE] * SIZE


def rows(*replacements: tuple[int, str]) -> list[str]:
    out = list(BLANK)
    for index, value in replacements:
        out[index] = value
    return out


def test_the_default_icon_is_blank_and_valid():
    icon = Icon()
    assert icon.palette == []
    assert icon.rows == BLANK


def test_a_drawing_indexes_its_palette():
    icon = Icon(palette=["#c8875a", "#2b211c"], rows=rows((0, "01" + "." * (SIZE - 2))))
    assert icon.rows[0].startswith("01")


@pytest.mark.parametrize(
    ("kwargs", "because"),
    [
        ({"palette": ["#C8875A"]}, "an upper-case colour is not the stored form"),
        ({"palette": ["c8875a"]}, "a colour needs its hash"),
        ({"palette": ["#fff"]}, "a colour is six digits"),
        ({"palette": [f"#{index:06x}" for index in range(17)]}, "17 colours is one too many"),
        ({"rows": BLANK[:-1]}, "15 rows is one too few"),
        ({"rows": rows((3, "." * (SIZE - 1)))}, "a short row"),
        ({"rows": rows((3, "." * (SIZE + 1)))}, "a long row"),
        ({"rows": rows((0, "0" * SIZE))}, "an index with an empty palette"),
        (
            {"palette": ["#c8875a"], "rows": rows((0, "1" + "." * (SIZE - 1)))},
            "an index past the end of the palette",
        ),
        ({"palette": ["#c8875a"], "rows": rows((0, "x" + "." * (SIZE - 1)))}, "not a hex digit"),
        ({"extra": 1}, "an unknown field"),
    ],
)
def test_a_drawing_that_could_not_be_rendered_is_refused(kwargs, because):
    with pytest.raises(ValidationError):
        Icon(**kwargs)
