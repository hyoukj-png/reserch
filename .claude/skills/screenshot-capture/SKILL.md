---
name: screenshot-capture
description: "웹사이트 리뉴얼 분석용 PC(1920×1080)·Mobile(375×812) 전체 페이지 스크린샷을 Playwright로 캡처하는 스킬. 주요 페이지 자동 선정, 풀페이지 캡처, 동적 컨텐츠 대기, 캐시 회피, 실패 격리 패턴을 포함한다. 트리거: '스크린샷 캡처', '페이지 캡처', 'PC/모바일 스크린샷', '반응형 스크린샷'."
---

# Screenshot Capture — Playwright 풀페이지 캡처 패턴

`collector` 에이전트가 사이트 리뉴얼 분석용으로 PC와 Mobile 뷰포트의 전체 페이지 스크린샷을 캡처할 때 사용한다.

## 언제 사용하는가

- `analyze_site.py` 가 분석 데이터를 수집한 후 (스크린샷은 별도 단계)
- 후속 에이전트(design-analyst, content-analyst)가 시각 검증할 자료가 필요할 때
- 사용자가 "이 페이지 PC/모바일 차이 확인"을 명시적으로 요청할 때

## 캡처 대상 선정 규칙

`output/{site_name}/pages.json` 또는 `analysis_data.json` 의 pages 배열에서 다음 우선순위로 선정:

1. **홈** (depth=0, URL이 사이트 루트)
2. **메인 메뉴 페이지** (depth=1)
3. **포트폴리오/콘텐츠 인덱스 페이지** (URL 패턴 매칭 또는 word_count 상위)
4. **개별 콘텐츠 페이지 1~2개** (depth≥2 중 대표성 있는 것)
5. **문의/연락처 페이지** (전환 CTA 페이지)

대형 사이트(>50페이지)는 8~12개 페이지로 제한. 작은 사이트는 모든 페이지 캡처 가능.

## 캡처 스크립트 패턴

다음과 같은 자기완결적 Python 스크립트를 `_workspace/raw/capture.py` 에 작성 후 실행:

```python
#!/usr/bin/env python3
"""PC/Mobile 풀페이지 스크린샷 캡처"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

SITE_NAME = sys.argv[1]
PAGES_JSON = f"output/{SITE_NAME}/pages.json"
OUT_PC = f"output/{SITE_NAME}/screenshots/pc"
OUT_MO = f"output/{SITE_NAME}/screenshots/mobile"

Path(OUT_PC).mkdir(parents=True, exist_ok=True)
Path(OUT_MO).mkdir(parents=True, exist_ok=True)


def slug(url: str) -> str:
    s = re.sub(r"^https?://[^/]+", "", url).strip("/")
    s = re.sub(r"[^A-Za-z0-9가-힣\-]+", "_", s)
    return s[:80] or "index"


def pick_pages(pages: list, limit: int = 10) -> list:
    """홈 + 깊이 1 + 대표 콘텐츠 페이지 선정."""
    by_depth = {}
    for p in pages:
        by_depth.setdefault(p.get("depth", 0), []).append(p)
    selected = []
    for d in sorted(by_depth.keys()):
        selected.extend(by_depth[d])
        if len(selected) >= limit:
            break
    return selected[:limit]


async def capture(url: str, slug_name: str, browser, viewport, out_dir):
    context = await browser.new_context(viewport=viewport, ignore_https_errors=True)
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="networkidle", timeout=30000)
        # 스크롤하여 lazy load 트리거
        await page.evaluate("""
            async () => {
                await new Promise(r => {
                    let h = 0;
                    const i = setInterval(() => {
                        window.scrollBy(0, 400);
                        h += 400;
                        if (h >= document.body.scrollHeight) { clearInterval(i); r(); }
                    }, 100);
                });
            }
        """)
        await page.wait_for_timeout(1000)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(500)
        out = os.path.join(out_dir, f"{slug_name}.png")
        await page.screenshot(path=out, full_page=True)
        print(f"  OK {out}")
        return out
    except Exception as e:
        print(f"  FAIL {url} ({viewport['width']}px): {e}")
        return None
    finally:
        await context.close()


async def main():
    with open(PAGES_JSON, encoding="utf-8") as f:
        pages = json.load(f)
    targets = pick_pages(pages, limit=10)
    print(f"Targets: {len(targets)} pages")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for t in targets:
            url = t["url"]
            name = slug(url)
            await capture(url, name, browser, {"width": 1920, "height": 1080}, OUT_PC)
            await capture(url, name, browser, {"width": 375, "height": 812}, OUT_MO)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
```

실행:

```bash
python _workspace/raw/capture.py {site_name}
```

## 캡처 옵션

| 옵션 | 기본 | 권장 변경 |
|------|------|----------|
| `full_page` | True | 유지 — 풀페이지 캡처가 분석에 필수 |
| `viewport PC` | 1920×1080 | 유지 |
| `viewport Mobile` | 375×812 (iPhone 13) | 일반 한국 사이트 기준 적합 |
| `wait_until` | networkidle | SPA가 매우 무거우면 `domcontentloaded` + 추가 wait |
| `timeout` | 30000ms | 느린 사이트는 60000ms |
| `headless` | True | 디버깅 시만 False |
| `ignore_https_errors` | True | 분석 목적이므로 허용 |

## 동적 콘텐츠 처리

- **Lazy load 이미지** — 페이지 끝까지 스크롤 후 다시 상단으로 복귀 (위 스크립트 포함)
- **쿠키 배너/팝업** — 첫 진입 시 자동 닫기 시도 (선택적):
  ```python
  for sel in ['button:has-text("동의")', 'button:has-text("확인")', '[aria-label*="close"]']:
      try: await page.locator(sel).first.click(timeout=2000)
      except: pass
  ```
- **무한 스크롤** — 1회 풀스크롤만 수행. 무한 스크롤 사이트는 첫 화면만 의미가 있으므로 충분
- **애니메이션 대기** — 스크롤 후 1000ms 대기로 in-view 애니메이션 완료 보장

## 출력 검증

- `output/{site_name}/screenshots/pc/*.png` 와 `output/{site_name}/screenshots/mobile/*.png` 가 동일 페이지 쌍을 이루는지 확인
- 파일 크기 0 또는 100B 미만 → 캡처 실패로 간주, 재시도
- 캡처 결과를 `collector_manifest.json` 의 `screenshots_pc`, `screenshots_mobile` 배열에 기록

## 에러 패턴 및 복구

| 증상 | 원인 | 복구 |
|------|------|------|
| Playwright 미설치 | `playwright` 모듈 없음 | `pip install playwright && npx playwright install chromium` |
| Browser launch 실패 | 시스템 라이브러리 누락 (Linux 등) | `npx playwright install-deps chromium` (sudo 필요 시 사용자 안내) |
| Navigation timeout | 사이트 응답 느림 또는 차단 | timeout 증가, User-Agent 검토 |
| 캡처 PNG 0 byte | 페이지가 networkidle 도달 못 함 | `wait_until="domcontentloaded"` 로 변경 + 추가 wait |
| 메모리 부족 | 너무 많은 페이지 병렬 캡처 | 순차 실행 (위 스크립트는 순차) |

## 주의사항

- **인증 필요 페이지** — 본 분석은 비로그인 공개 페이지가 대상. 인증 후 페이지가 필요하면 별도 절차 (사용자 쿠키 import 등) 필요
- **파일명 충돌** — slug가 동일하면 덮어쓰기. 다국어 사이트는 path를 그대로 인코딩 보존 권장
- **저작권** — 분석용 캡처는 fair use, 외부 배포 시 검토 필요
