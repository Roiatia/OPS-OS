#!/usr/bin/env bash
# Publish wiki/ markdown files to the GitHub wiki for Roiatia/OPS-OS.
#
# Prerequisites:
#   1. Enable Wikis: GitHub repo → Settings → Features → Wikis ✓
#   2. Create the first wiki page on GitHub (any page) so the .wiki.git repo exists
#   3. git credentials with push access to the repo
#
# Usage (from repo root):
#   ./scripts/publish-wiki.sh
#   ./scripts/publish-wiki.sh --dry-run

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_SRC="$ROOT/wiki"
REPO="Roiatia/OPS-OS"
WIKI_REMOTE="https://github.com/${REPO}.wiki.git"
WORK_DIR="${TMPDIR:-/tmp}/ops-os-wiki-publish-$$"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ ! -d "$WIKI_SRC" ]]; then
  echo "Missing wiki source folder: $WIKI_SRC"
  exit 1
fi

echo "→ Wiki source: $WIKI_SRC"
echo "→ Target: $WIKI_REMOTE"

if $DRY_RUN; then
  echo ""
  echo "Dry run — pages that would be published:"
  find "$WIKI_SRC" -name '*.md' -type f | sort | while read -r f; do
    echo "  $(basename "$f")"
  done
  exit 0
fi

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$WORK_DIR"

if git ls-remote "$WIKI_REMOTE" &>/dev/null; then
  echo "→ Cloning existing wiki..."
  git clone "$WIKI_REMOTE" "$WORK_DIR/repo"
else
  echo ""
  echo "Wiki repo not found. Enable it first:"
  echo "  https://github.com/${REPO}/settings"
  echo "  Features → Wikis → check \"Wikis\""
  echo ""
  echo "Then create any page via the Wiki tab (e.g. a blank Home page)."
  echo "Re-run: ./scripts/publish-wiki.sh"
  exit 1
fi

echo "→ Copying wiki pages..."
rsync -a --delete --include='*.md' --exclude='*' "$WIKI_SRC/" "$WORK_DIR/repo/"

cd "$WORK_DIR/repo"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Wiki is already up to date."
  exit 0
fi

git add -A
git commit -m "Sync wiki from ops-os repo ($(date +%Y-%m-%d))"

echo "→ Pushing to GitHub wiki..."
git push origin master 2>/dev/null || git push origin main

echo ""
echo "Done! View at: https://github.com/${REPO}/wiki"
