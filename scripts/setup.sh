#!/usr/bin/env bash
# 다른 컴퓨터에서 이 프로젝트 환경을 한 번에 셋업한다.
# 사용: bash scripts/setup.sh   (저장소 루트에서 실행)
#
# 하네스(.claude/agents, .claude/skills, CLAUDE.md)는 clone만으로 이미 동작하므로
# 이 스크립트는 "수집 스크립트 실행에 필요한 런타임 환경"을 준비한다.
# python3/node가 없으면 OS별 패키지 매니저로 자동 설치를 시도한다.
#   - 자동 설치를 끄려면:  SKIP_AUTO_INSTALL=1 bash scripts/setup.sh
set -e

cd "$(dirname "$0")/.."   # 저장소 루트로 이동
echo "📦 프로젝트 루트: $(pwd)"

OS="$(uname -s)"
# 루트가 아니면 sudo 사용(있을 때만)
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# ── 패키지 매니저 추상화 ──────────────────────────────────────────
linux_pm_install() {
  # $@ = 설치할 패키지명들
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y && $SUDO apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm "$@"
  elif command -v zypper >/dev/null 2>&1; then
    $SUDO zypper install -y "$@"
  else
    return 1
  fi
}

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  echo "🍺 Homebrew 미설치 → 설치 시도(시간이 걸릴 수 있습니다)..."
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || return 1
  # 현재 셸 PATH에 brew 등록 (Apple Silicon / Intel 경로 모두 시도)
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$p" ] && eval "$("$p" shellenv)"
  done
  command -v brew >/dev/null 2>&1
}

# tool=실행파일명, 그 외 인자는 (brew패키지 | linux패키지들...)
install_tool() {
  local tool="$1"; shift
  local brew_pkg="$1"; shift
  echo "🔧 $tool 미설치 → 자동 설치 시도..."
  case "$OS" in
    Darwin)
      ensure_brew && brew install "$brew_pkg"
      ;;
    Linux)
      linux_pm_install "$@"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      if command -v winget >/dev/null 2>&1; then winget install -e --id "$brew_pkg" || return 1
      elif command -v choco >/dev/null 2>&1; then choco install -y "$brew_pkg" || return 1
      else return 1; fi
      ;;
    *) return 1 ;;
  esac
}

ensure_python() {
  if command -v python3 >/dev/null 2>&1; then return 0; fi
  if [ "${SKIP_AUTO_INSTALL:-0}" = "1" ]; then return 1; fi
  # Darwin: brew 'python'  /  Linux: python3 + venv + pip  /  Win(winget): Python.Python.3
  case "$OS" in
    Darwin) install_tool python3 python ;;
    Linux)  install_tool python3 python python3 python3-venv python3-pip ;;
    MINGW*|MSYS*|CYGWIN*) install_tool python3 Python.Python.3 ;;
  esac
  command -v python3 >/dev/null 2>&1
}

ensure_node() {
  if command -v npm >/dev/null 2>&1; then return 0; fi
  if [ "${SKIP_AUTO_INSTALL:-0}" = "1" ]; then return 1; fi
  case "$OS" in
    Darwin) install_tool node node ;;
    Linux)  install_tool node node nodejs npm ;;
    MINGW*|MSYS*|CYGWIN*) install_tool node OpenJS.NodeJS ;;
  esac
  command -v npm >/dev/null 2>&1
}

# ── 1) Python ─────────────────────────────────────────────────────
if ! ensure_python; then
  echo "❌ python3를 준비하지 못했습니다. 수동 설치 후 다시 실행하세요."
  echo "   macOS: brew install python | Debian/Ubuntu: sudo apt-get install python3 python3-venv python3-pip"
  exit 1
fi
PY="$(command -v python3)"
echo "🐍 python3: $PY ($($PY --version 2>&1))"

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

# ── 2) Node 도구 (스크린샷·Lighthouse) — 선택 ─────────────────────
if ensure_node; then
  echo "📦 Node 의존성 설치 (lighthouse, playwright)..."
  npm install --silent
  echo "🌐 Playwright Chromium 설치..."
  npx -y playwright install chromium
  echo "  ✅ Node 도구 완료"
else
  echo "  ⚠️ npm을 준비하지 못했습니다 — 스크린샷/Lighthouse는 건너뜁니다."
  echo "     (수집 핵심 분석은 Python만으로 동작합니다. 필요 시 node 설치 후 'npm install && npx playwright install chromium')"
fi

echo ""
echo "🎉 셋업 완료. 다음으로:"
echo "   1) 수집:  venv/bin/python scripts/analyze_site.py https://example.com/"
echo "   2) 런타임 보강: npm run runtime -- https://example.com/ --max-pages 8 --max-clicks 14"
echo "   3) 분석:  Claude Code에서 '리뉴얼 분석해줘' (하네스가 output/{site}/를 분석)"
