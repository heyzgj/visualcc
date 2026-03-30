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
check "T8.6 5 escalation principles" "test $(grep -c -E 'Reversibility|Blast radius|Precedent|Cost.*Safety|Taste.*Design' src/templates/reviewer-prompt.ts) -eq 5"

echo ""
echo "--- tmux Backend ---"
check "T2.1 which_tool exists" "grep -q 'fn which_tool' src-tauri/src/pty_manager.rs"
check "T2.9 TERM set" "grep -q 'xterm-256color' src-tauri/src/pty_manager.rs"

echo ""
echo "--- tmux Integration ---"
CLAUDE_PATH=$(which claude 2>/dev/null)
if [ -n "$CLAUDE_PATH" ]; then
  tmux kill-session -t e2e-cc 2>/dev/null
  check "T2.2 Claude in tmux" "tmux new-session -d -s e2e-cc -x 80 -y 24 -c /tmp -- $CLAUDE_PATH && sleep 4 && tmux capture-pane -t e2e-cc -p | grep -q 'Claude' && tmux kill-session -t e2e-cc"
else
  echo "  SKIP: Claude not installed"
fi

CODEX_PATH=$(which codex 2>/dev/null)
if [ -n "$CODEX_PATH" ]; then
  tmux kill-session -t e2e-cx 2>/dev/null
  check "T2.4 Codex in tmux" "tmux new-session -d -s e2e-cx -x 80 -y 24 -c /tmp -- $CODEX_PATH && sleep 4 && tmux has-session -t e2e-cx && tmux kill-session -t e2e-cx"
else
  echo "  SKIP: Codex not installed"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
