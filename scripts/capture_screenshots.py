"""
주요 페이지의 PC + Mobile 풀페이지 스크린샷 캡처
Usage: python3 capture_screenshots.py <site_dir>
  site_dir/pages.json에서 URL 목록을 읽어 주요 페이지 캡처
"""
import sys
import os
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

MAX_PAGES = 8
PC_VIEWPORT = {"width": 1920, "height": 1080}
MOBILE_VIEWPORT = {"width": 375, "height": 812}
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)


def slugify(url: str) -> str:
    s = re.sub(r"^https?://[^/]+", "", url).strip("/")
    if not s:
        return "index"
    s = re.sub(r"[^a-zA-Z0-9\-_]+", "_", s)
    return s[:80] or "index"


def pick_pages(pages_json_path: str, limit: int = MAX_PAGES):
    with open(pages_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pages = data.get("pages") if isinstance(data, dict) else data
    if not pages:
        return []
    seen = set()
    urls = []
    for p in pages:
        u = p.get("url") or p.get("URL")
        if not u or u in seen:
            continue
        seen.add(u)
        urls.append(u)
        if len(urls) >= limit:
            break
    return urls


def capture(site_dir: str):
    pages_json = os.path.join(site_dir, "pages.json")
    if not os.path.exists(pages_json):
        print(f"❌ pages.json not found: {pages_json}", file=sys.stderr)
        return {"captured_pc": [], "captured_mobile": [], "errors": ["pages.json missing"]}

    urls = pick_pages(pages_json, MAX_PAGES)
    if not urls:
        return {"captured_pc": [], "captured_mobile": [], "errors": ["no urls"]}

    pc_dir = os.path.join(site_dir, "screenshots", "pc")
    mb_dir = os.path.join(site_dir, "screenshots", "mobile")
    os.makedirs(pc_dir, exist_ok=True)
    os.makedirs(mb_dir, exist_ok=True)

    captured_pc, captured_mb, errors = [], [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # PC
        pc_ctx = browser.new_context(viewport=PC_VIEWPORT)
        for url in urls:
            slug = slugify(url) + ".png"
            out = os.path.join(pc_dir, slug)
            try:
                page = pc_ctx.new_page()
                page.goto(url, wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(1500)
                page.screenshot(path=out, full_page=True)
                captured_pc.append(slug)
                print(f"  ✓ PC {slug}")
                page.close()
            except Exception as e:
                errors.append(f"PC {url}: {e}")
                print(f"  ✗ PC {url}: {e}")
                try:
                    page.close()
                except Exception:
                    pass
        pc_ctx.close()

        # Mobile
        mb_ctx = browser.new_context(
            viewport=MOBILE_VIEWPORT,
            user_agent=MOBILE_UA,
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        for url in urls:
            slug = slugify(url) + ".png"
            out = os.path.join(mb_dir, slug)
            try:
                page = mb_ctx.new_page()
                page.goto(url, wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(1500)
                page.screenshot(path=out, full_page=True)
                captured_mb.append(slug)
                print(f"  ✓ Mobile {slug}")
                page.close()
            except Exception as e:
                errors.append(f"Mobile {url}: {e}")
                print(f"  ✗ Mobile {url}: {e}")
                try:
                    page.close()
                except Exception:
                    pass
        mb_ctx.close()

        browser.close()

    return {"captured_pc": captured_pc, "captured_mobile": captured_mb, "errors": errors}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 capture_screenshots.py <site_dir>", file=sys.stderr)
        sys.exit(2)
    result = capture(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
