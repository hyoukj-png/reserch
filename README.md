# Antigravity Research — 웹사이트 리뉴얼 분석 하네스

기존 웹사이트를 분석해 리뉴얼·벤치마킹에 필요한 데이터를 수집하고, **전문 에이전트 팀(하네스)**이 AI 종합 분석·벤치마킹 레시피·리포트를 생성하는 프로젝트.

- 수집: `scripts/analyze_site.py` (정적 크롤링 + 기술/디자인/콘텐츠/모달 추출)
- 분석: Claude Code 하네스 (`.claude/agents/` + `.claude/skills/`) — 기술/디자인/콘텐츠 분석가 병렬 → 통합 → QA
- 설계 상세: `DESIGN.md`, 하네스 트리거·이력: `CLAUDE.md`

## 다른 컴퓨터에서 이 환경 재현하기

### 1. 클론
```bash
git clone https://github.com/hyoukj-png/reserch.git
cd reserch
```

### 2. Python 환경 (수집 스크립트)
```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r scripts/requirements.txt
```

### 3. Node 도구 (스크린샷·성능 측정)
```bash
npm install                        # lighthouse, playwright
npx playwright install chromium
```

### 4. Claude Code 하네스
`.claude/agents/`·`.claude/skills/`는 **저장소에 포함되어 클론하면 바로 동작**합니다(프로젝트 로컬 하네스).
- 하네스 실행: Claude Code에서 `리뉴얼 분석해줘` 또는 `output/{site} 벤치마킹 분석` → `renewal-analysis` 오케스트레이터가 작동
- (선택) 하네스 자체를 **재설계/확장**하려면 메타 플러그인 설치: `/plugin install harness@harness-marketplace` 후 `/reload-plugins`. 단순 실행에는 불필요.

### 5. 분석 흐름
```bash
# (1) 수집 — 정적 데이터 + 모달/숨김 콘텐츠 자동 복구 → output/{site}/ 생성
python scripts/analyze_site.py https://example.com/
# (2) 분석 — Claude Code에서 하네스 실행 → 05/07/08-renewal-insights, BENCHMARK_RECIPE, COMPLETION_REPORT 생성
```

## 저장소에 포함되는 것 / 제외되는 것

**포함(버전 관리):**
- `.claude/agents/`, `.claude/skills/`, `.claude/settings.json` — 하네스 구성
- `CLAUDE.md`, `DESIGN.md`, `README.md` — 문서·하네스 포인터
- `scripts/` — 수집 스크립트 + requirements
- `.agent/workflows/` — 워크플로우, `.wiki-compiler.json` — 위키 설정
- `package.json` / `package-lock.json` — Node 의존성
- `docs/FEATURE_PROPOSAL_*.md` — 기획 문서

**제외(.gitignore):** `output/`, `venv/`, `node_modules/`, `cheongnabit-com/`(대용량 분석 데이터), `wiki/`(생성물), 툴 상태(`*.bkit-memory.json` 등), `.claude/settings.local.json`(머신별 권한 설정).

## ⚠️ 다른 머신으로 따라가지 않는 것 (저장소 밖)

- **Claude 메모리** (`~/.claude/projects/<hash>/memory/`) — 머신 로컬. 단, 핵심 학습(예: JS 모달 수집 맹점)은 `CLAUDE.md` 변경 이력과 분석 스킬 가드에 반영되어 있어 동작에는 지장 없음.
- **`venv/`·`node_modules/`** — 위 2·3단계로 재생성.
- **`.claude/settings.local.json`** — 머신별 권한 허용목록. 새 머신에서는 Claude Code가 필요 시 다시 묻습니다.
