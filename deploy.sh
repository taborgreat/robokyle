#!/usr/bin/env bash
# Build the React app and publish the site to GitHub Pages.
#
#   ./deploy.sh                 build, commit the output, push
#   ./deploy.sh "message"       same, with your own commit message
#
# Pages serves this repo's root, so the build output (app.html, 404.html and
# public/assets/react/) is committed like any other file. Pushing is the deploy.
set -euo pipefail
cd "$(dirname "$0")"

MESSAGE=${1:-"Rebuild site"}
OUTPUT=(app.html 404.html public/assets/react)

echo "==> building"
npm --prefix frontend_react run build

echo "==> staging the site"
git add "${OUTPUT[@]}"

# Anything else you have edited is left alone; commit it yourself when ready.
OTHER=$(git status --porcelain -- . ':!app.html' ':!404.html' ':!public/assets/react' | wc -l)
[ "$OTHER" -gt 0 ] && echo "    note: $OTHER other changed file(s) left uncommitted"

if git diff --cached --quiet; then
  echo "==> nothing changed, site is already up to date"
else
  git commit -q -m "$MESSAGE"
  echo "==> committed: $MESSAGE"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push -q origin "$BRANCH"
echo "==> pushed to origin/$BRANCH"
echo "    Pages usually redeploys within a minute: https://robokyle.org"
