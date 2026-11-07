#!/usr/bin/env python3
"""Rebuild docs/star-history.svg from GitHub stargazer timestamps.

Guarantees: when it writes, the corner count equals the number of plotted
events, and the last point is that count. An empty fetch does not overwrite
the existing SVG.
Does not guarantee: GitHub returned every historical star. The curve is only
as complete as the stargazer list this run received.
Trigger: `python3 scripts/update_star_history.py /tmp/ysf-stars.tsv`
Stop: wrote the SVG, or refused because the input had zero events.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "star-history.svg"
CST = timezone(timedelta(hours=8))


def load_times(path: Path) -> list[datetime]:
    """Read starred_at values. A TSV may put the time in column 1.

    Guarantees: returned times are timezone-aware and sorted.
    Does not guarantee: duplicate people were removed. The caller dedupes.
    """
    times: list[datetime] = []
    for raw in path.read_text().splitlines():
        cell = raw.split("\t", 1)[0].strip()
        if not cell:
            continue
        times.append(datetime.fromisoformat(cell.replace("Z", "+00:00")))
    times.sort()
    return times


def build_star_svg(times: list[datetime]) -> str:
    """Draw a step curve. Y is the cumulative count, X is Beijing time.

    Guarantees: aria-label count, corner count, and path end all equal len(times).
    Does not guarantee: a pretty axis when every star landed in the same minute.
    """
    if not times:
        raise ValueError("no star events")
    n = len(times)
    width, height = 760, 360
    left, right, top, bottom = 58, 732, 56, 308
    t0 = times[0].timestamp()
    t1 = times[-1].timestamp()
    span = max(t1 - t0, 1.0)

    def x_of(ts: float) -> float:
        return left + (ts - t0) / span * (right - left)

    def y_of(count: int) -> float:
        return bottom - (count / n) * (bottom - top)

    parts = [f"M {x_of(t0):.1f} {y_of(0):.1f}"]
    for i, when in enumerate(times, start=1):
        x = x_of(when.timestamp())
        parts.append(f"L {x:.1f} {y_of(i - 1):.1f} L {x:.1f} {y_of(i):.1f}")
    parts.append(f"L {right:.1f} {y_of(n):.1f}")
    last_x = x_of(times[-1].timestamp())
    ticks = []
    for step in range(6):
        tx = left + (right - left) * step / 5
        when = datetime.fromtimestamp(t0 + span * step / 5, tz=CST)
        label = when.strftime("%m-%d %H:%M")
        ticks.append(
            f'<line x1="{tx:.1f}" y1="{top}" x2="{tx:.1f}" y2="{bottom}" stroke="#f3eadc" stroke-width="1"/>'
            f'<text x="{tx:.1f}" y="328" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="12" fill="#6d6256">{label}</text>'
        )
    y_ticks = []
    for step in range(5):
        count = round(n * step / 4)
        yy = y_of(count)
        y_ticks.append(
            f'<line x1="{left}" y1="{yy:.1f}" x2="{right}" y2="{yy:.1f}" stroke="#e6dccb" stroke-width="1"/>'
            f'<text x="50" y="{yy + 4:.1f}" text-anchor="end" font-family="ui-sans-serif, sans-serif" font-size="12" fill="#6d6256">{count}</text>'
        )
    start = times[0].astimezone(CST).strftime("%Y-%m-%d %H:%M")
    end = times[-1].astimezone(CST).strftime("%Y-%m-%d %H:%M")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Star 累计 {n}">
<rect width="100%" height="100%" fill="#fffdf8"/>
<text x="58" y="32" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="18" font-weight="700" fill="#2b241c">Star 累计</text>
<text x="732" y="32" text-anchor="end" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="18" font-weight="700" fill="#8b4513">{n}</text>
{''.join(y_ticks)}
{''.join(ticks)}
<path d="{' '.join(parts)}" fill="none" stroke="#8b4513" stroke-width="2.5" stroke-linejoin="round"/>
<circle cx="{last_x:.1f}" cy="{y_of(n):.1f}" r="4" fill="#8b4513"/>
<text x="58" y="352" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="12" fill="#6d6256">北京时间 · GitHub stargazers · {start} 至 {end} · 共 {n}</text>
</svg>
'''


def main() -> int:
    """Write the SVG from a timestamp file. Stop without writing when empty."""
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ysf-stars.tsv")
    times = load_times(src)
    if not times:
        print("refused: zero events, old svg kept")
        return 2
    OUT.write_text(build_star_svg(times))
    print(f"wrote {OUT} count={len(times)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
