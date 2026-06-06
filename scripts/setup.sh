#!/usr/bin/env bash
# 다른 컴퓨터에서 이 프로젝트 환경을 한 번에 셋업한다.
# 사용: bash scripts/setup.sh   (저장소 루트에서 실행)
#
# 하네스(.claude/agents, .claude/skills, CLAUDE.md)는 clone만으로 이미 동작하므로
# 이 스크립트는 "수집 스크립트 실행에 필요한 런타임 환경"만 준비한다.
set -e

cd "$(dirname "$0")/.."   # 저장소 루트로 이동
echo "📦 프로젝트 루트: $(pwd)"

# 1) Python 가상환경 + 의존성
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then echo "❌ python3가 필요합니다. 먼저 설치하세요."; exit 1; fi
if [ ! -d venv ]; then
  echo "🐍 venv 생성..."
  "$PY" -m venv venv
fi
# shellcheck disable=SC1091
if [ -f venv/bin/activate ]; then source venv/bin/activate; else source venv/Scripts/activate; fi
echo "🐍 Python 의존성 설치..."
pip install --quiet --upgrade pip
pip install --quiet -r scripts/requirements.txt
echo "  ✅ Python 의존성 완료"

# 2) Node 도구 (스크린샷·Lighthouse) — node가 있을 때만
if command -v npm >/dev/null 2>&1; then
  echo "📦 Node 의존성 설치 (lighthouse, playwright)..."
  npm install --silent
  echo "🌐 Playwright Chromium 설치..."
  npx -y playwright install chromium
  echo "  ✅ Node 도구 완료"
else
  echo "  ⚠️ npm 미설치 — 스크린샷/Lighthouse는 건너뜀(수집 핵심 분석은 Python만으로 동작)"
fi

echo ""
echo "🎉 셋업 완료. 다음으로:"
echo "   1) 수집:  venv/bin/python scripts/analyze_site.py https://example.com/"
echo "   2) 분석:  Claude Code에서 '리뉴얼 분석해줘' (하네스가 output/{site}/를 분석)"
