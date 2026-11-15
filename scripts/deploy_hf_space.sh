#!/usr/bin/env bash
# Publish the app to a Hugging Face Space (Docker SDK).
#
# Hugging Face rejects files over 10 MB unless they are stored with Git LFS.
# This script makes a separate, clean copy of the app branch, tracks the large
# data files with LFS, and pushes that copy to the Space. The GitHub history is
# not changed.
#
# Requirements: git and git-lfs (brew install git-lfs && git lfs install).
#
# usage: scripts/deploy_hf_space.sh <space-git-url> [branch]
#   <space-git-url>  e.g. https://huggingface.co/spaces/USER/lunar-navigator
#   [branch]         app branch to publish (default: diego/hf-space)
set -euo pipefail

SPACE_URL="${1:?usage: $0 <space-git-url> [branch]}"
BRANCH="${2:-diego/hf-space}"

if ! command -v git-lfs >/dev/null 2>&1; then
  echo "Git LFS is required: brew install git-lfs && git lfs install" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone -q --branch "$BRANCH" "$ROOT" "$WORK/app"
cd "$WORK/app"
rm -rf .git
git init -q -b main
git lfs install --local >/dev/null
git lfs track "*.tif" "*.bsp" "*.bpc" >/dev/null
git add .gitattributes .
git -c user.name="Space deploy" -c user.email="deploy@localhost" \
  commit -q -m "Deploy Lunar Landing Site Navigator to Hugging Face Spaces"
git remote add space "$SPACE_URL"
git push -f space main
echo "Published to $SPACE_URL"
