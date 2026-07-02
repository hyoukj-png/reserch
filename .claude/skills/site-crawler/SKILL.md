---
name: site-crawler
description: "웹사이트 리뉴얼 분석을 위해 scripts/analyze_site.py를 안전하게 실행하는 스킬. Python/패키지 부트스트랩, 인자 구성, 출력 검증, 부분 재실행, 에러 복구 패턴을 포함한다. URL 크롤링, 페이지 수집, 콘텐츠 추출, 디자인 토큰 추출이 필요할 때 사용. 트리거: '사이트 크롤링', '페이지 수집', 'analyze_site.py 실행', 'URL 크롤'."
---

# Site Crawler — analyze_site.py 실행 패턴

`scripts/analyze_site.py` 는 Phase 1~5(접속·기술스택·크롤링·콘텐츠·디자인 토큰) 를 통합 자동화한 1469줄 스크립트다. 본 스킬은 이 스크립트를 호출하는 정확한 방법, 인자 선택, 출력 검증, 에러 복구를 담는다.

## 언제 사용하는가

- `collector` 에이전트가 Phase 2 데이터 수집을 수행할 때
- 사용자가 직접 "사이트 크롤링" 또는 "페이지 수집"만 요청할 때
- 부분 재실행: 단일 페이지 또는 옵션 변경 후 재크롤링

## 핵심 호출 패턴

### 기본 (전체 Phase 1~5)

```bash
python scripts/analyze_site.py {URL}
```

출력 디렉토리: `output/{site_name}/` (script가 자동 생성)
site_name 산정: `re.sub(r'https?://','',url).replace('/','_').replace('.','_')[:30].strip('_')`

### 주요 플래그

| 플래그 | 효과 | 언제 |
|--------|------|------|
| (없음) | 기본 동작: trafilatura + pages 저장 + boilerplate 감지 | 기본 |
| `--no-trafilatura` | trafilatura 미사용, BS4만 | trafilatura 미설치 환경 또는 결과 비교 |
| `--no-pages` | 페이지별 .md 저장 안 함 | 대용량 사이트에서 디스크 절약 |
| `--no-boilerplate` | boilerplate 라인 제거 안 함 | 보일러플레이트 감지가 본문을 잘라먹을 때 |

> 플래그 상세는 `scripts/analyze_site.py` 상단의 상수(`USE_TRAFILATURA`, `SAVE_INDIVIDUAL_PAGES` 등) 와 argparse 정의 참조.

## 사전 조건 자동 확인

스크립트 호출 전 다음을 확인하고, 누락 시 자동 설치를 시도한다:

```bash
# Python 패키지 (스크립트 내부에도 부트스트랩 있음, 그래도 명시적으로)
pip install -r scripts/requirements.txt

# Playwright (스크립트 내부에서 import는 안 하지만, 후속 스크린샷 단계가 필요)
npx -y playwright install chromium
```

설치 실패 시 사용자에게 "환경 확인 필요" 보고. 추측으로 진행하지 않는다.

## 출력 검증

스크립트 실행 후 다음 파일이 존재해야 한다 (없으면 부분 실패):

| 경로 | 내용 |
|------|------|
| `output/{site_name}/00-summary.md` | 분석 요약 |
| `output/{site_name}/01-site-structure.md` | 사이트 구조 |
| `output/{site_name}/02-tech-stack.md` | 기술 스택 |
| `output/{site_name}/03-design-tokens.md` | 디자인 토큰 |
| `output/{site_name}/04-content-inventory.md` | 콘텐츠 인벤토리 |
| `output/{site_name}/05-components.md` | 컴포넌트 초안 (없으면 후속 분석에서 생성) |
| `output/{site_name}/06-interaction.md` | 인터랙션 초안 |
| `output/{site_name}/pages/*.md` | 페이지별 본문 (--no-pages 사용 시 생략) |
| `output/{site_name}/pages/_index.md` | 페이지 인덱스 |
| `output/{site_name}/pages/_sitemap-tree.md` | 사이트맵 트리 |
| `output/{site_name}/pages.json` | 페이지 메타 JSON |
| `output/{site_name}/analysis_data.json` | 통합 JSON |
| `output/{site_name}/assets/images/` | 다운로드된 이미지 |

검증 로직:
1. 모든 필수 .md 파일 존재 확인
2. `analysis_data.json` 파싱 가능 여부
3. `pages.json` 의 페이지 수 ≥ 1
4. 누락 시 manifest의 `errors` 배열에 기록

## 매니페스트 생성

스크립트 종료 후 `_workspace/raw/collector_manifest.json` 작성:

```json
{
  "url": "https://example.com",
  "site_name": "example_com",
  "site_dir": "output/example_com",
  "files_generated": ["00-summary.md", "01-site-structure.md", "..."],
  "pages_count": 91,
  "images_count": 55,
  "errors": [],
  "completed_at": "2026-06-02T14:30:00Z"
}
```

후속 에이전트(tech/design/content-analyst, qa-reviewer)가 이 매니페스트를 진입점으로 사용한다.

## 부분 재실행 패턴

| 요청 | 처리 |
|------|------|
| "다시 크롤링" + 동일 URL | `output/{site_name}/` 그대로 두고 재실행 (script가 덮어쓰기) |
| "이 페이지만 다시" | 단일 페이지 모드는 현재 미지원 — 전체 재크롤링 또는 수동 fetch 후 pages/ 에 추가 |
| "본문 추출 품질 개선" | `--no-boilerplate` 또는 trafilatura 옵션 토글 후 재실행, 결과 비교 |

## 에러 패턴 및 복구

| 증상 | 원인 | 복구 |
|------|------|------|
| `ImportError: No module named 'requests'` | 패키지 미설치 | 스크립트 자체 부트스트랩 작동, 또는 `pip install -r scripts/requirements.txt` |
| `403 Forbidden` 또는 `429` | User-Agent 차단, rate limit | scripts/analyze_site.py의 `REQUEST_DELAY` 증가, 또는 HEADERS 수정 검토 (코드 변경 시 사용자 승인) |
| Timeout (`TIMEOUT=15`) 빈발 | 사이트 응답 느림 | TIMEOUT 상수 증가 (코드 변경 시 승인) |
| `analysis_data.json` 생성 안 됨 | 스크립트가 중간에 종료 | stdout 로그 확인하여 어느 Phase에서 실패했는지 파악 |
| pages 디렉토리 권한 오류 | 디스크/권한 문제 | 사용자에게 보고, 강제 진행 금지 |

## 로그 보존

스크립트 stdout 전체를 `_workspace/raw/collector.log` 에 저장:

```bash
python scripts/analyze_site.py {URL} 2>&1 | tee _workspace/raw/collector.log
```

이 로그는 후속 디버깅과 qa-reviewer의 검증 근거로 활용된다.

## 주의사항

- **사이트 정책 준수** — robots.txt 의 `Disallow` 경로는 스크립트가 자체 처리. 추가 우회 코드 작성 금지.
- **저작권** — 이미지 다운로드는 분석 목적의 fair use이지만, 산출물에 재배포 시 별도 검토 필요. BENCHMARK_RECIPE에 라이센스 경고 포함을 권장.
- **요청 간격** — `REQUEST_DELAY=0.5s` 가 기본. 대상 사이트가 작거나 민감하면 증가 검토.
- **MAX_PAGES=200, MAX_DEPTH=3** — 매우 큰 사이트는 잘릴 수 있음. 필요시 상수 조정 (사용자 승인).
