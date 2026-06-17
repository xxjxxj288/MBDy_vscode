#!/bin/bash
set -euo pipefail

# === Configuration ===
REPO="xxjxxj288/MBDy_vscode"
PROJECT_DIR="C:/Users/LENOVO/Desktop/MBdynstudy/mbsim-vscode-extension"
VSIX_NAME="mbsim-language-support"

# === Argument parsing ===
VERSION="${1:?Usage: $0 X.Y.Z (e.g. $0 1.1.9)}"

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: Version must be in X.Y.Z format (e.g. 1.1.9)"
  exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN environment variable is not set."
  echo "Please set it: export GITHUB_TOKEN=ghp_..."
  exit 1
fi

echo "=== Releasing $VSIX_NAME v$VERSION ==="

# Step A: Update version in package.json
python3 -c "
import json, sys
pkg_path = r'$PROJECT_DIR/package.json'
with open(pkg_path, 'r') as f:
    pkg = json.load(f)
old_ver = pkg['version']
pkg['version'] = '$VERSION'
with open(pkg_path, 'w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
print(f'Version updated: {old_ver} -> $VERSION')
"

# Step B: Compile TypeScript
cd "$PROJECT_DIR"
npm run compile
echo "Compilation successful."

# Step C: Package .vsix
npx vsce package
VSIX_FILE="$PROJECT_DIR/$VSIX_NAME-$VERSION.vsix"
if [ ! -f "$VSIX_FILE" ]; then
  echo "ERROR: .vsix file not found at $VSIX_FILE"
  echo "Expected file: $VSIX_NAME-$VERSION.vsix"
  exit 1
fi
echo "Packaged: $VSIX_FILE"

# Step D: Get latest release info
echo "Fetching latest release info..."
RELEASE_JSON=$(curl -sS -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/releases/latest")

RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Release ID: $RELEASE_ID"

# Step E: Delete existing .vsix assets
echo "Cleaning up old .vsix assets..."
ASSET_IDS=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
release = json.load(sys.stdin)
for a in release.get('assets', []):
    if a['name'].endswith('.vsix'):
        print(a['id'])
")
for ASSET_ID in $ASSET_IDS; do
  echo "  Deleting asset $ASSET_ID..."
  curl -sS -X DELETE -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID" > /dev/null
done

# Step F: Update release name and body
echo "Updating release metadata..."
curl -sS -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github.v3+json" \
  -d "{\"name\":\"$VSIX_NAME\",\"body\":\"v$VERSION\"}" \
  "https://api.github.com/repos/$REPO/releases/$RELEASE_ID" > /dev/null

# Step G: Upload the new .vsix asset
echo "Uploading $VSIX_NAME-$VERSION.vsix..."
UPLOAD_RESPONSE=$(curl -sS -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$VSIX_FILE" \
  "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$VSIX_NAME-$VERSION.vsix")

echo "$UPLOAD_RESPONSE" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(f'Asset uploaded: {r.get(\"name\", \"?\")} ({r.get(\"size\", 0)} bytes)')
print(f'Download URL: {r.get(\"browser_download_url\", \"?\")}')
"

echo ""
echo "=== Release v$VERSION complete! ==="
echo "Extension users will see: mbsim-language-support-$VERSION.vsix"
