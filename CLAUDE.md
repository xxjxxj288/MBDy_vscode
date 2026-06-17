# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MBDyn Language Support is a VS Code extension providing syntax highlighting, autocompletion, diagnostics, cross-reference validation, hover hints, and simulation tooling for MBDyn multibody dynamics input files (`.mbs`, `.mbsim`). Published as `mbsim-language-support`.

## Build & Development

```bash
npm run compile          # tsc -p ./ — compiles src/ → out/
npm run watch            # tsc -watch -p ./
npm run vscode:prepublish  # runs compile (used before packaging into .vsix)
```

The extension entry point is `./out/extension.js` (compiled from `src/extension.ts`). There is no test suite.

To test locally: open this folder in VS Code, press F5 to launch an Extension Development Host.

## Architecture

The single source of truth is [src/extension.ts](src/extension.ts) (~1200 lines). There is also [src/extension.js](src/extension.js) which is a **separate, older implementation** using block-based syntax (`[BLOCKNAME]`/`[/BLOCKNAME]`) — it is NOT compiled or loaded; only the TypeScript version is active.

### Core Data Structures

- **`MBSIM_SCHEMA`** (line ~601): The central registry of all MBDyn keywords (`RIGIDBODY`, `GEOMETRY`, `FNODE`, `CONSTRAINT`, etc.), each with an array of valid parameters, optional `typeOptions` (enum values for `TYPE`), and a description.
- **`PARAM_DOCS`** (line ~632): Human-readable documentation strings for every parameter, shown in hover tooltips.
- **`crossRefRules`** (line ~281): Rules mapping keyword+param combinations to definition sets for cross-reference validation. Supports `isMultiValue` (comma-separated values like `NODES`) and `isMultiSet` (values checked across multiple sets like `INPUT.NAME`).
- **`definitionSets`** (line ~302): Seven `Set<string>` instances (`geometries`, `materials`, `sections`, `markers`, `fnodes`, `rigidbodies`, `constraints`) that hold all defined names collected from the current document and URDF files.
- **`PARAM_OPTIONS`** (line ~625): Boolean-style parameters (`FIX`, `COLLIDE`, `VALID`, etc.) with choices `["0", "1"]`.

### Key Functions

- **`activate()`** (line ~775): Registers all providers, commands, and status bar items. Validates open documents on startup, checks for simulator/extension updates on a delay.
- **`collectDefinitionsAsync(lines)`** (line ~448): Clears and rebuilds `definitionSets` by parsing definition lines and URDF files.
- **`validateDocument(document)`** (line ~920): Main diagnostic pipeline — collects definitions, then checks each line for Chinese characters, comment placement, unknown keywords, invalid params, bad TYPE values, negative numeric values, and cross-reference errors.
- **`resolveVariables(text, document)`** (line ~683): Expands `${file}`, `${workspaceFolder}`, `${fileBasenameNoExt}`, etc. in config strings.
- **Completion provider** (line ~788): Single `CompletionItemProvider` handling keyword completion (with auto-incrementing IDs via `getNextId()`), parameter completion (with snippet templates per param), and context-aware name completion (existing materials, geometries, markers, etc. extracted via `extractNames()`).

### URDF Integration

`parseUrdfFilesAsync()` (line ~402) uses `vscode.workspace.findFiles('**/*.urdf')` to find all URDF files in the workspace, then parses `<link name="...">` → `rigidbodies` set and `<joint name="...">` → `constraints` set. This runs on every document change for `.mbs` files.

### Extension Self-Update

The extension checks GitHub releases at `xxjxxj288/MBDy_vscode` for newer `.vsix` files. If found, it downloads and installs via the `code --install-extension` CLI. A changelog webview is shown on next start via globalState flags (`SHOW_CHANGELOG_ON_NEXT_START_KEY`).

### Simulator Management

Downloads MBDyn simulator `.exe` from GitHub releases at `xxjxxj288/MBdyn`, saves to user-chosen location, and auto-configures `mbsim.simulator.path`. Daily update checks compare the local filename against the latest release filename.

## Configuration Keys

All under the `mbsim` namespace:
- `simulator.path` — full path to MBDyn executable
- `simulator.args` — CLI args (default: `${file}`)
- `simulator.downloadUrl` — base URL for simulator downloads
- `simulator.autoCheckUpdates` — boolean, daily check
- `paraview.path` — full path to ParaView executable (default: `paraview`)
- `paraview.casePattern` — pattern for `.case` file (default: `${fileBasenameNoExt}.case`)
- `extension.autoCheckUpdates` — boolean, daily extension update check

## File Format Details

- Line comments start with `!` (must be at column 0)
- Bracket pairs `[...]`/`[/...]` are treated as block comments by the TextMate grammar, but the TypeScript-based extension uses the `KEYWORD/ID, name, PARAM=value, ...` format
- File extensions: `.mbs`, `.mbsim`
- Language ID: `mbsim`

## Release Process

When the user says "发布新版本 X.Y.Z" or asks to publish a new release:

### Prerequisites
- The project's `.token` file contains a GitHub PAT with `repo` scope (read it via `Read` tool).
- The user provides the version number (e.g., `1.1.9`).

### Release Steps (Manual — Primary Method)

`scripts/release.sh` is unreliable on Windows bash due to multi-line Python `-c` string issues. Use the following manual steps instead. Read the token from `.token` into a shell variable first:

```bash
cd "C:/Users/LENOVO/Desktop/MBdynstudy/mbsim-vscode-extension"
TOKEN="ghp_xxx"  # read from .token file
```

**Step 1 — Update extension content**: Edit `src/extension.ts` (keywords, parameters, diagnostics, completions, etc.) and any other source files needed.

**Step 2 — Update version**: Edit `package.json`, change `"version": "X.Y.Z"`

**Step 3 — Compile & Package**:
```bash
npm run compile
npx vsce package
```

**Step 4 — Commit & Push source**:
```bash
git add -A
git commit -m "Release vX.Y.Z: <brief summary of changes>"
git push origin master
```

**Step 5 — Upload .vsix to GitHub Release**:
```bash
# Fetch latest release and extract ID
RELEASE_ID=$(curl -sS -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/xxjxxj288/MBDy_vscode/releases/latest" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Find and delete old .vsix assets
ASSET_IDS=$(curl -sS -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/xxjxxj288/MBDy_vscode/releases/latest" | \
  python3 -c "import sys,json; r=json.load(sys.stdin); [print(a['id']) for a in r.get('assets',[]) if a['name'].endswith('.vsix')]")
for aid in $ASSET_IDS; do
  curl -sS -X DELETE -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/xxjxxj288/MBDy_vscode/releases/assets/$aid" -o /dev/null
done

# Update metadata
curl -sS -X PATCH -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"mbsim-language-support","body":"vX.Y.Z"}' \
  "https://api.github.com/repos/xxjxxj288/MBDy_vscode/releases/$RELEASE_ID" -o /dev/null

# Upload new .vsix (note: uploads.github.com, NOT api.github.com)
curl -sS -X POST -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@mbsim-language-support-X.Y.Z.vsix" \
  "https://uploads.github.com/repos/xxjxxj288/MBDy_vscode/releases/$RELEASE_ID/assets?name=mbsim-language-support-X.Y.Z.vsix"
```

### Important Notes
- The upload endpoint is `uploads.github.com` (NOT `api.github.com`)
- The Content-Type for `.vsix` upload MUST be `application/octet-stream`
- Always update the existing release (tag `mbdyn_vscode`) so the extension's auto-update finds it via `/releases/latest`
- The `.vsix` filename MUST follow `mbsim-language-support-X.Y.Z.vsix` for the extension to parse the version correctly
- The `.token` file is excluded from `.vsix` packaging via `.vscodeignore` — never remove that exclusion
