#!/usr/bin/env python3
"""docs/world-map-preview.html(정본) → 스크립트를 인라인한 단일 파일(아티팩트 게시용).

usage: python scripts/build-world-map-artifact.py <출력 경로>
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
page = (ROOT / "docs/world-map-preview.html").read_text(encoding="utf-8")
page = page[page.index("<title>"):].replace("</html>", "")


def inline(match):
    return "<script>\n" + (ROOT / "docs" / match.group(1)).read_text(encoding="utf-8") + "\n</script>"


page = re.sub(r'<script src="(\.\./source/[^"]+)"></script>', inline, page)
Path(sys.argv[1]).write_text(page, encoding="utf-8")
