# VisualCC E2E Test Plan

## Prerequisites

- macOS with `tmux` installed (`brew install tmux`)
- `claude` CLI installed and authenticated (Claude Code)
- `codex` CLI installed (OpenAI Codex) — optional, skip Codex tests if not available
- VisualCC built and running: `cargo tauri dev` or `/Applications/VisualCC.app`

## How to Test

Each test has:
- **Steps**: What to do
- **Pass condition**: What must be true
- **How to verify**: Terminal command or UI check

Tests marked [BACKEND] can be verified from terminal without clicking the UI.
Tests marked [UI] require interacting with the Tauri app window.
Tests marked [CODE] can be verified by reading source code.

---

## Section 1: Build & Startup

### T1.1 — TypeScript compiles
```bash
npm run build
```
**Pass**: Exit code 0, no TypeScript errors (warnings about chunk size OK)

### T1.2 — Rust compiles
```bash
cd src-tauri && cargo check
```
**Pass**: Exit code 0 (1 warning about unused `list_sessions` is acceptable)

### T1.3 — App starts without crash
```bash
cargo tauri dev 2>/tmp/visualcc-test.log &
sleep 20
grep -i "Maximum update\|panic\|Unhandled error" /tmp/visualcc-test.log
```
**Pass**: No matches found. App window appears.

### T1.4 — No infinite render loops
```bash
grep -i "getSnapshot should be cached" /tmp/visualcc-test.log
```
**Pass**: No matches found.

---

## Section 2: tmux Backend [BACKEND]

### T2.1 — tmux detection works
```bash
# From Rust backend perspective
cd src-tauri && grep "check_tmux" src/pty_manager.rs | head -3
```
**Pass**: `check_tmux()` method exists, runs `which tmux`, returns bool.

### T2.2 — Session creates tmux session
```bash
# Kill old sessions
tmux list-sessions 2>/dev/null | grep vcc | cut -d: -f1 | xargs -I{} tmux kill-session -t {} 2>/dev/null

# Create a session via the app (click + New Session, enter path, click Launch)
# Then verify:
tmux list-sessions 2>/dev/null | grep vcc
```
**Pass**: At least one `vcc-{uuid}` session exists.

### T2.3 — Claude Code runs inside tmux
```bash
# Get the session name from T2.2
SESSION_NAME=$(tmux list-sessions 2>/dev/null | grep vcc | head -1 | cut -d: -f1)
tmux capture-pane -t "$SESSION_NAME" -p | head -5
```
**Pass**: Output contains "Claude Code" or the Claude welcome screen.

### T2.4 — Codex runs inside tmux
```bash
# Create a Codex session via the app, then:
SESSION_NAME=$(tmux list-sessions 2>/dev/null | grep vcc | tail -1 | cut -d: -f1)
tmux capture-pane -t "$SESSION_NAME" -p | head -5
```
**Pass**: Output contains codex UI or update prompt.

### T2.5 — Sessions survive app close
```bash
# Note session names
tmux list-sessions 2>/dev/null | grep vcc > /tmp/before-close.txt

# Close the VisualCC app (Cmd+Q or pkill)
pkill -f visualcc
sleep 2

# Check sessions still exist
tmux list-sessions 2>/dev/null | grep vcc > /tmp/after-close.txt
diff /tmp/before-close.txt /tmp/after-close.txt
```
**Pass**: No diff — sessions are still running after app close.

### T2.6 — Sessions discoverable on reopen
```bash
# Reopen the app
open /Applications/VisualCC.app
# or: cargo tauri dev
sleep 5

# Check Rust logs
grep "discover" /tmp/visualcc-test.log | tail -3
```
**Pass**: Ghost tiles appear with "Reattach" button (verified in UI).

### T2.7 — Reattach works
**Steps**: Click "Reattach" button on a live ghost tile.
**Pass**: Terminal shows Claude Code output. Tile status changes from ghost to running.

### T2.8 — Shift+click kills tmux session
```bash
# Note session count before
tmux list-sessions 2>/dev/null | grep -c vcc

# Shift+click the X button on a tile in the UI

# Check session count after
tmux list-sessions 2>/dev/null | grep -c vcc
```
**Pass**: Count decreased by 1. The specific tmux session is gone.

### T2.9 — Tool resolved to absolute path
```bash
grep "which_tool" src-tauri/src/pty_manager.rs
```
**Pass**: `which_tool()` function exists and is called before tmux spawn. This ensures `claude`/`codex` commands are resolved even if tmux's shell doesn't have NVM in PATH.

---

## Section 3: Session Rendering [UI]

### T3.1 — New session tile appears on canvas
**Steps**: Click "+ New Session" → enter a valid directory → click Launch.
**Pass**: Dialog closes. A tile appears on the canvas with the directory name as label.

### T3.2 — Terminal shows Claude Code output (not blank)
**Steps**: Create a Claude Code session. Wait 5 seconds.
**Pass**: Tile's terminal area shows the Claude Code welcome screen (not blank/white).

### T3.3 — Terminal is interactive
**Steps**: Click inside the terminal area of a tile. Type a prompt (e.g. "hello").
**Pass**: Characters appear in the terminal. Claude responds.

### T3.4 — Zoom levels work
**Steps**: Scroll to zoom out to ~30%, then ~10%.
**Pass**:
- At 30-70%: Tile shows compact card (tool icon + label)
- At <30%: Tile shows minimal icon
- Terminal disposes (saves memory)

### T3.5 — Zoom back in restores terminal
**Steps**: After T3.4, zoom back in to 100%.
**Pass**: Terminal re-appears with output (may lose scrollback but shows new output from PTY buffer).

### T3.6 — Tile resize works
**Steps**: Drag the resize handle (bottom-right corner of tile).
**Pass**: Tile resizes. Terminal refits to new size.

### T3.7 — Double-click zooms to tile
**Steps**: Double-click a tile header.
**Pass**: Canvas smoothly zooms to fit that tile.

### T3.8 — Escape fits all
**Steps**: Press Escape key.
**Pass**: Canvas zooms to fit all tiles.

---

## Section 4: Status Detection [UI + BACKEND]

### T4.1 — Running status (green)
**Steps**: Create a session and type a prompt. While Claude is generating output...
**Pass**: Status badge shows "Running" with blue/green indicator.

### T4.2 — Idle status (gray)
**Steps**: Wait for Claude to finish responding (>3 seconds of no output).
**Pass**: Status badge shows "Idle".

### T4.3 — Needs Input only on prompts (orange)
**Steps**: Wait 30+ seconds after Claude finishes a turn (idle, no question).
**Pass**: Status stays "Idle" — does NOT change to "Needs Input". Only actual Y/n or permission prompts trigger "Needs Input".

### T4.4 [CODE] — No time-based active status
```bash
grep "elapsed.*10000" src/hooks/useSessionEvents.ts
```
**Pass**: No matches. The old `elapsed < 10000` → `active` logic is removed.

### T4.5 [CODE] — Prompt-based active only
```bash
grep "updateStatus.*'active'" src/hooks/useSessionEvents.ts
```
**Pass**: Only appears inside question detection blocks (YN_REGEX, PERMISSION_REGEX, SIGNAL_WORDS_REGEX).

---

## Section 5: Session Persistence [UI + BACKEND]

### T5.1 — Sessions persist as ghosts on restart
**Steps**: Create 2 sessions. Close app (Cmd+Q). Reopen app.
**Pass**: 2 ghost tiles appear at their previous positions.

### T5.2 — Ghost tile shows correct info
**Pass**: Each ghost tile shows:
- Tool icon (C for Claude, X for Codex)
- Directory path
- "Previous session" or "Session still running" label
- "Re-launch" or "Reattach" button

### T5.3 — Re-launch creates new session
**Steps**: Click "Re-launch" on a ghost tile.
**Pass**: Ghost replaced with live session tile. Terminal shows Claude Code starting.

### T5.4 — Dismiss removes ghost
**Steps**: Click X on a ghost tile (not shift+click).
**Pass**: Ghost tile disappears.

---

## Section 6: Theme & UI Polish [UI]

### T6.1 — Dark mode default
**Pass**: App opens in dark mode (dark background, light text).

### T6.2 — Light mode toggle
**Steps**: Click the moon/sun icon in toolbar.
**Pass**: Entire app switches to light mode. Canvas, tiles, toolbar, dialog all update.

### T6.3 — Terminal theme matches app theme
**Steps**: With a running session, toggle theme.
**Pass**: Terminal background and text colors change to match the theme.

### T6.4 — Theme persists
**Steps**: Switch to light mode. Close app. Reopen.
**Pass**: App opens in light mode (persisted to localStorage).

---

## Section 7: New Session Dialog [UI]

### T7.1 — Dialog opens
**Steps**: Click "+ New Session".
**Pass**: Dialog appears with tool selector, directory input, task name, initial prompt, preview URL fields.

### T7.2 — Launch disabled without path
**Pass**: Launch button is disabled/grayed when Project Directory is empty.

### T7.3 — Launch enabled with path
**Steps**: Type a valid path in Project Directory.
**Pass**: Launch button becomes enabled (orange).

### T7.4 — Error shown on failure
**Steps**: Type an invalid/nonexistent path. Click Launch.
**Pass**: Red error message appears in the dialog (not silent failure).

### T7.5 — Recent directories shown
**Steps**: After creating a session, open New Session dialog again.
**Pass**: "Recent" section shows previously used directories. Clicking one fills in the path and tool.

### T7.6 — Cancel closes dialog
**Steps**: Click Cancel.
**Pass**: Dialog closes. No session created.

---

## Section 8: Vacation Mode [UI]

### T8.1 — Vacation Mode tab exists
**Pass**: "Vacation Mode" tab is visible in toolbar next to "Founder Mode".

### T8.2 — Clicking Vacation Mode starts reviewer
**Steps**: Click "Vacation Mode" tab.
**Pass**: Tab shows "Starting..." briefly. If successful, view switches to Decision Queue. If failed (no sessions), error message appears.

### T8.3 — Decision Queue empty state
**Pass**: When no decisions pending, shows "Nothing needs you. N sessions running smoothly."

### T8.4 — Switch back to Founder Mode
**Steps**: Click "Founder Mode" tab (or "View Canvas" button).
**Pass**: Canvas view returns. All sessions still visible.

### T8.5 [CODE] — Reviewer session uses ~/.clockwork/ CWD
```bash
grep "clockwork" src/hooks/useReviewerSession.ts | head -5
```
**Pass**: Reviewer session CWD is set to `~/.clockwork/`.

### T8.6 [CODE] — CLAUDE.md has 5 escalation principles
```bash
grep -c "Reversibility\|Blast radius\|Precedent\|Cost.*Safety\|Taste.*Design" src/templates/reviewer-prompt.ts
```
**Pass**: Count is 5.

---

## Section 9: Error Handling [UI + CODE]

### T9.1 [CODE] — No full-store subscriptions in useSession
```bash
grep "useSessionStore()" src/hooks/useSession.ts
```
**Pass**: No matches. Should only use `useSessionStore((s) => s.specificField)`.

### T9.2 [CODE] — EMPTY_MESSAGES constant prevents render loops
```bash
grep "EMPTY_MESSAGES" src/components/SessionNode.tsx
```
**Pass**: Constant is defined and used in the messages selector (not `?? []`).

### T9.3 [CODE] — setOnSessionEvent doesn't trigger re-renders
```bash
grep "setOnSessionEvent" src/stores/sessionStore.ts
```
**Pass**: Implementation uses `_sessionEventCallback = callback` (module-level variable), NOT `set({ onSessionEvent: callback })`.

### T9.4 [CODE] — renderMode set atomically
```bash
grep "addSession(session, 'terminal')" src/hooks/useSession.ts
```
**Pass**: At least 1 match. No separate `setRenderMode` call after `addSession`.

### T9.5 [CODE] — PTY output buffered before terminal mount
```bash
grep "bufferRef" src/hooks/usePtyOutput.ts | wc -l
```
**Pass**: Count > 3 (buffer exists, is used, is replayed).

---

## Section 10: Circuit Breaker [CODE]

### T10.1 — Circuit breaker constants
```bash
grep "MAX_BLOCKS\|BLOCK_WINDOW" src/hooks/useClockwork.ts
```
**Pass**: MAX_BLOCKS = 3, BLOCK_WINDOW = 600000 (10 minutes).

### T10.2 — Resolution timer resets breaker
```bash
grep "startResolutionTimer\|recordResolution" src/hooks/useClockwork.ts
```
**Pass**: Both functions exist. Resolution timer clears block history after 60s.

---

## Section 11: Minimap & Canvas [UI]

### T11.1 — Minimap visible
**Pass**: Minimap appears in bottom-right corner showing tile positions.

### T11.2 — Status dots in minimap
**Pass**: Tiles in minimap are colored by status (blue=running, gray=idle, etc.).

### T11.3 — Organize button
**Steps**: Create 3+ sessions. Click "Organize".
**Pass**: Tiles rearrange into a grid layout.

### T11.4 — Scroll isolation
**Steps**: Scroll inside a terminal tile.
**Pass**: Canvas does NOT zoom. Only the terminal scrolls.

---

## Quick Test Script (Backend Only)

Run this to verify all backend/code tests at once:

```bash
#!/bin/bash
echo "=== VisualCC E2E Backend Tests ==="
PASS=0; FAIL=0

check() {
  if eval "$2" > /dev/null 2>&1; then
    echo "  PASS: $1"; ((PASS++))
  else
    echo "  FAIL: $1"; ((FAIL++))
  fi
}

echo ""
echo "--- Build ---"
check "T1.1 TypeScript compiles" "npm run build"
check "T1.2 Rust compiles" "cd src-tauri && cargo check"

echo ""
echo "--- Code Quality ---"
check "T4.4 No time-based active" "! grep -q 'elapsed.*10000' src/hooks/useSessionEvents.ts"
check "T9.1 No full-store subscription" "! grep -q 'useSessionStore()' src/hooks/useSession.ts"
check "T9.2 EMPTY_MESSAGES exists" "grep -q 'EMPTY_MESSAGES' src/components/SessionNode.tsx"
check "T9.3 No re-render on callback" "grep -q '_sessionEventCallback = callback' src/stores/sessionStore.ts"
check "T9.4 Atomic renderMode" "grep -q \"addSession(session, 'terminal')\" src/hooks/useSession.ts"
check "T9.5 PTY output buffered" "test $(grep -c 'bufferRef' src/hooks/usePtyOutput.ts) -gt 3"
check "T8.6 5 escalation principles" "test $(grep -c 'Reversibility\|Blast radius\|Precedent\|Cost.*Safety\|Taste.*Design' src/templates/reviewer-prompt.ts) -eq 5"

echo ""
echo "--- tmux Backend ---"
check "T2.1 which_tool exists" "grep -q 'fn which_tool' src-tauri/src/pty_manager.rs"
check "T2.9 TERM set" "grep -q 'xterm-256color' src-tauri/src/pty_manager.rs"

echo ""
echo "--- tmux Integration ---"
check "T2.2 Claude in tmux" "tmux new-session -d -s e2e-cc -x 80 -y 24 -c /tmp -- $(which claude) && sleep 3 && tmux capture-pane -t e2e-cc -p | grep -q 'Claude' && tmux kill-session -t e2e-cc"
CODEX_PATH=$(which codex 2>/dev/null)
if [ -n "$CODEX_PATH" ]; then
  check "T2.4 Codex in tmux" "tmux new-session -d -s e2e-cx -x 80 -y 24 -c /tmp -- $CODEX_PATH && sleep 3 && tmux has-session -t e2e-cx && tmux kill-session -t e2e-cx"
else
  echo "  SKIP: T2.4 Codex not installed"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
```

Save as `scripts/e2e-test.sh` and run with `bash scripts/e2e-test.sh`.

---

## UI Tests Summary (Manual / Codex)

| # | Test | Action | Pass Condition |
|---|------|--------|----------------|
| T3.1 | New session tile | Create session | Tile appears on canvas |
| T3.2 | Terminal not blank | Wait 5s | Claude welcome screen visible |
| T3.3 | Terminal interactive | Type in tile | Characters appear, Claude responds |
| T3.4 | Zoom out | Scroll to 30% | Tiles show compact cards |
| T3.5 | Zoom in | Scroll to 100% | Terminal re-appears |
| T3.6 | Resize | Drag handle | Tile resizes, terminal refits |
| T3.7 | Double-click zoom | Double-click tile | Canvas zooms to tile |
| T3.8 | Escape fits all | Press Escape | Canvas fits all tiles |
| T4.1 | Running status | During output | Badge shows "Running" |
| T4.2 | Idle status | After output stops | Badge shows "Idle" |
| T4.3 | No false active | Wait 30s idle | Badge stays "Idle" (not "Needs Input") |
| T5.1 | Ghost tiles | Close + reopen app | Ghost tiles appear |
| T5.3 | Re-launch | Click Re-launch | New session starts |
| T6.1 | Dark mode | App open | Dark background |
| T6.2 | Light toggle | Click theme button | Light mode |
| T6.3 | Terminal theme | Toggle theme | Terminal colors change |
| T7.1 | Dialog opens | Click + New Session | Dialog with all fields |
| T7.2 | Launch disabled | Empty path | Button grayed out |
| T7.4 | Error shown | Invalid path + Launch | Red error message |
| T8.1 | Vacation tab | Look at toolbar | Tab visible |
| T8.3 | Empty queue | Switch to Vacation | "Nothing needs you" message |
| T11.1 | Minimap | Look at bottom-right | Minimap visible |
| T11.4 | Scroll isolation | Scroll in terminal | Canvas doesn't zoom |
