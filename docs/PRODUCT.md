# VisualCC — Product Document

> The only tool that turns 10 parallel AI sessions into something a human brain can hold at once.

---

## 1. Problem

When using multiple AI coding agents (Claude Code, Codex) simultaneously across different projects, the current workflow is:

1. Open 5-10 separate terminal windows
2. Alt-tab between them constantly
3. Manually track which session is doing what, which one needs input, which one errored
4. Copy-paste output between sessions when one agent's work needs to inform another
5. Lose everything on app restart — re-open terminals, re-type prompts, re-remember context

**You are the dashboard. You are the router. You are the bottleneck.**

---

## 2. Solution

VisualCC is a native desktop app (Tauri v2 + React) that places all AI coding sessions on an **infinite canvas**. Each session is a tile that shows what the AI **produced** — not the terminal that produced it.

### Core Experience

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INFINITE CANVAS                            │
│                                                                     │
│   ┌──────────────────┐     ┌──────────────────┐                    │
│   │ Auth Refactor  ✓ │     │ API Migration  ● │                    │
│   │ 4 files changed  │────▶│ Running tests... │                    │
│   │ All tests pass   │     │                  │                    │
│   └──────────────────┘     └──────────────────┘                    │
│                                    │                                │
│                                    ▼                                │
│                            ┌──────────────────┐                    │
│                            │ Frontend    ⚠    │                    │
│                            │ "Delete file?"   │                    │
│                            │ [Yes] [No]       │                    │
│                            └──────────────────┘                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Wedge / Differentiator

### Competitive Landscape (March 2026)

27+ tools exist in this space. They fall into three categories:

| Category | Tools | Limitation |
|----------|-------|------------|
| **TUI session managers** | Superset, Claude Squad, dmux, Amux, Agent of Empires | Terminal-only. No visual overview. |
| **Desktop GUI apps** | Mux (Coder), Claudia | Traditional sidebar/list layout. Not spatial. |
| **IDE-native** | Cursor (8 agents), Windsurf, VS Code multi-agent | Locked to one IDE. Can't mix tools. |

**What nobody has built:**

A native desktop infinite canvas that:
1. Shows RESULTS (live app previews, rendered docs) instead of terminals
2. Lets you draw connections between sessions to pipe output between them
3. Works across Claude Code AND Codex (agent-agnostic)
4. Is spatial — arrangement matches your mental model

**VisualCC's wedge is not "manage sessions" (tmux does that). It's the only tool that makes 10 parallel AI sessions glanceable, visual, and connected.**

---

## 4. What's Built (Shipped)

### Phase 1-6: Core Product (Complete)

| Feature | Description |
|---------|-------------|
| **Infinite Canvas** | @xyflow/react with zoom, pan, minimap. Tiles draggable. |
| **PTY Terminal Tiles** | Each tile runs claude/codex CLI via portable-pty. Full xterm.js interactive terminal. |
| **Session Launcher** | Tool picker (Claude/Codex), directory browser, initial prompt, task name, preview URL. |
| **Status Detection** | Automatic: running (< 3s), idle (3-10s), needs input (> 10s), done/error (process exit). Status glows and pulse animation. |
| **Zoom-Adaptive Rendering** | < 30%: icon only. 30-70%: smart card. > 70%: full terminal. Saves memory. |
| **Session Persistence** | Sessions survive app restart as "ghost" tiles. Re-launch with one click. `beforeunload` flush. |
| **Recent Directories** | Last used directories shown in new session dialog for quick re-launch. |
| **Theme System** | Dark/light mode with Anthropic-derived color palette. Persisted. |
| **OS Notifications** | Native alerts when sessions need input or error. Toggle in toolbar. |
| **Terminal Scroll Isolation** | Native DOM event listener prevents terminal scroll from zooming the canvas. |
| **Keyboard Shortcuts** | Escape = fit all. Double-click = zoom to tile. |
| **Resizable Tiles** | Drag handle, min/max constraints (360-1200 x 240-900). |

### Phase 8: Results Canvas (Complete)

The paradigm shift — tiles show RESULTS, not terminals.

| Feature | Description |
|---------|-------------|
| **Smart Subtitles** | Every tile shows a 1-line description of what the AI is doing right now. Parsed from PTY output, ANSI-stripped. Visible at ALL zoom levels. |
| **Live App Preview** | If the AI starts a dev server (Vite, Next, CRA), the tile auto-detects the URL and shows a live iframe preview. HMR updates live. |
| **Rendered Markdown** | For chat-mode sessions, AI output rendered as formatted markdown instead of raw terminal text. |
| **Question Surfacing** | When the AI asks Y/n or permission prompts, a QuestionCard overlay appears on the tile with [Yes] [No] buttons. Answerable without zooming in. |
| **Outcome Cards** | When a session completes, shows structured summary: files changed, test results, duration. |
| **View Toggle** | At interactive zoom, toggle between preview and terminal. Terminal is always one click away. |
| **Auto-detected URLs** | Regex scans PTY output for `http://localhost:\d+` — no manual config needed. |

---

## 5. What's Next (Designed, Not Built)

### Phase 9: Session Connections — Inter-Session Data Flow

**Problem**: You manually copy-paste output between sessions. You are the router.

**Solution**: Draw visual connections (edges) between tiles. Output flows through the wires.

#### How It Works

1. **Hover a tile** → connection handles appear (small dots, top and bottom)
2. **Drag** from tile A's bottom handle to tile B's top handle → edge appears with arrow
3. **Click ▶** on the edge → A's last 20 lines of output are sent to B's terminal as typed input
4. **Toggle Auto** on the edge → when A finishes, output automatically flows to B

#### Visual Feedback

- Edge line: blue solid (manual), green dashed (auto-forward on)
- Edge pulses when data flows
- Arrow shows direction
- Midpoint controls: [▶ Forward] [A Auto-toggle]

#### Forwarded Text Format

When output flows from session "Dev: Auth API" to another session, the target receives:

```
Output from session 'Dev: Auth API':

---
[last 20 lines of ANSI-stripped output]
---

Please review and continue from here.
```

This appears as typed input in the target's terminal. Claude/Codex processes it as context.

#### Re-launch with Context

When you click ▶ but the target session is already done/ghost:
- VisualCC offers: "Re-launch with this context?"
- Click → new session created with the forwarded text as the initial prompt
- Enables iterative cycles: specialist finishes → output to lead → lead reviews → lead's instructions back to specialist

#### Loop Prevention

| Guardrail | Mechanism |
|-----------|-----------|
| **Completion-only trigger** | Auto-forward fires ONLY when source status changes to 'done'. One-time per lifecycle. |
| **One-way auto-forward** | Auto: Specialist → Lead only. Lead → Specialist ALWAYS requires human click. |
| **Prompt engineering** | Lead's prompt: "STOP and wait for my instructions after each review." |
| **Human gate** | Human is always between Lead's output and next Specialist's input. |

#### Lead + Specialist Pattern

A specific workflow enabled by session connections:

```
                    ┌─────────────────┐
         ┌────────▶│   Lead Session   │◀────────┐
         │         │  Reviews results  │         │
         │         │  Plans next steps │         │
         │         └─────────────────┘         │
         │              ▲       ▲              │
    auto-forward    auto-forward  auto-forward
    on complete     on complete   on complete
         │              │       │              │
    ┌────┴────┐    ┌────┴──┐ ┌──┴────┐    ┌────┴────┐
    │  Dev    │    │ GTM   │ │Design │    │Curation │
    │Specialist│   │Spec.  │ │Spec.  │    │Spec.    │
    └─────────┘    └───────┘ └───────┘    └─────────┘
```

**Lead Session Template:**
```
You are the project lead for [project]. Goal: [goal].
You'll receive results from specialist sessions. For each:
1. Review the output
2. Assess progress toward the overall goal
3. Recommend specific next steps for each specialist
4. If you need my decision, ask clearly and wait
After each review, STOP and wait for my instructions.
```

**Complete Flow:**

| Step | Actor | Action |
|------|-------|--------|
| 1 | Human | Creates Lead session with lead template prompt |
| 2 | Human | Creates Specialist sessions (Dev, Design, GTM...) |
| 3 | Human | Draws edges: each Specialist → Lead (auto-forward ON) |
| 4 | Specialist | Works on its task (minutes) |
| 5 | System | Specialist finishes → auto-forward fires → Lead receives output |
| 6 | Lead Claude | Reviews output, assesses progress, asks human if needed |
| 7 | System | QuestionCard appears on Lead tile + OS notification |
| 8 | Human | Answers Lead's question via QuestionCard |
| 9 | Human | Reads Lead's plan, clicks ▶ on Lead→Specialist edge to dispatch |
| 10 | System | If Specialist is done, offers re-launch with Lead's context |
| 11 | - | Cycle repeats until Lead assesses "100% complete" |

**Alert Mechanism (How Lead Surfaces Questions):**
- Lead's Claude outputs a question ending with `?`
- VisualCC's output intelligence detects the `?` pattern while session is idle (>10s)
- QuestionCard overlay appears on Lead's tile
- OS notification fires: "Lead Session needs input"
- Human answers via QuestionCard (text input + Send), or clicks "See Terminal" for full view
- Answer is written to Lead's PTY stdin

**Failure Scenarios:**

| Scenario | Handling |
|----------|---------|
| Specialist errors | Auto-forward fires with error output. Lead assesses failure. |
| Human disagrees with Lead | Types correction directly into Lead's terminal. |
| Specialist needs input mid-work | QuestionCard on Specialist tile. Human answers directly. |
| Multiple specialists finish at once | Each auto-forward fires independently. Lead receives in sequence (PTY is serial). |
| Lead crashes | Ghost tile. Re-launch. Edges persist. |
| Human changes goal | Types new goal into Lead's terminal. Lead re-assesses. |

---

## 6. Architecture

```
Tauri v2 Window
├── React Frontend (webview)
│   ├── @xyflow/react Canvas (zoom, pan, minimap, EDGES)
│   │   ├── SessionNode[] (custom nodes — tiles)
│   │   │   ├── Smart subtitle (from output intelligence)
│   │   │   ├── PreviewPane (iframe of dev server)
│   │   │   ├── MarkdownPreview (rendered output)
│   │   │   ├── QuestionCard (surfaced Y/n prompts)
│   │   │   ├── OutcomeCard (completion summary)
│   │   │   └── xterm.js terminal (toggle, backstage)
│   │   └── ForwardEdge[] (custom edges — connections)
│   │       ├── ▶ Forward button
│   │       └── Auto-forward toggle
│   ├── Toolbar (new session, organize, theme, notifications)
│   └── NewSessionDialog (tool, dir, task name, prompt, preview URL)
│
├── Zustand Stores
│   ├── sessionStore (sessions, intel, connections, messages, tileSizes)
│   ├── recentsStore (recent directories)
│   ├── themeStore (dark/light)
│   └── settingsStore (notifications toggle)
│
├── Global Hooks
│   ├── useStatusDetector (activity timing → status)
│   ├── useOutputIntelligence (PTY parsing → subtitles, URLs, questions)
│   └── useAutoForwarder (completion → edge forwarding)
│
├── Tauri IPC Bridge
│
└── Rust Backend
    ├── PtyManager (PTY spawn/read/write/resize/kill)
    ├── ProcessManager (structured JSON output mode)
    ├── SessionStore (in-memory session tracking)
    └── Tauri Commands (8 exported commands)
```

### Data Flow

```
PTY Process (claude/codex CLI)
  → Reader thread emits session:output:{id} events (raw bytes)
  → Frontend listeners:
      usePtyOutput → xterm.js terminal rendering
      useOutputIntelligence → ANSI strip → subtitle, URL detect, question detect
      useStatusDetector → activity timestamp → status badge
  → sessionStore.sessionIntel[id] updated (debounced 200ms)
  → SessionNode re-renders with new subtitle / question / preview

User answers question:
  QuestionCard → writeToSession(id, "y\n") → Tauri command → PTY stdin → Claude continues

Edge forward:
  forwardOutput(edgeId) → getOutputBuffer(source) → last 20 lines → writeToSession(target, formatted text)
```

---

## 7. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop Shell | Tauri v2 | Lightweight (~5MB), Rust backend, native feel |
| Frontend | React 19 + TypeScript + Vite | Fast dev, large ecosystem |
| Canvas | @xyflow/react 12 | Zoom, pan, minimap, edges, node management |
| Terminal | @xterm/xterm 6 + addon-fit | GPU-accelerated, industry standard |
| State | Zustand 5 | Minimal, no boilerplate |
| Markdown | react-markdown + react-syntax-highlighter | Already bundled, proven |
| PTY | portable-pty 0.8 (Rust) | Cross-platform PTY spawning |
| Async | Tokio (Rust) | Async runtime for reader threads |
| Notifications | tauri-plugin-notification | Native OS alerts |

---

## 8. What VisualCC is NOT

| Not this | Why |
|----------|-----|
| **Remote control tool** | For remote/phone access, use OpenClaw + bash + tmux. VisualCC is for when you're AT your desk. |
| **AI orchestrator** | VisualCC doesn't coordinate agents. Claude Agent Teams does that. VisualCC is the visual layer for the HUMAN. |
| **IDE** | VisualCC doesn't edit code. It manages the agents that edit code. |
| **Terminal multiplexer** | tmux is a terminal multiplexer. VisualCC is a results canvas. |
| **Enterprise tool** | Personal tool for individual developers managing parallel AI sessions. |

---

## 9. Success Criteria

You would reach for VisualCC every morning if:

1. Opening it shows exactly where you left off (ghost tiles with context)
2. At a glance, you know what each session is doing (smart subtitles)
3. When something needs your input, you answer without context-switching (QuestionCard)
4. You see the result, not the terminal (live preview / rendered markdown)
5. Output flows between sessions without copy-paste (edges)
6. The spatial arrangement matches your mental model (canvas > list > tabs)

---

## 10. Open Questions

1. **Output replay buffer**: When you zoom out and back in, terminal scrollback is lost. Should we add a Rust-side ring buffer to replay output on reconnect?
2. **Keyboard shortcuts**: Should we add Cmd+N (new session), Cmd+1-9 (jump to session), Cmd+W (kill)?
3. **Session grouping**: Should tiles be groupable into named clusters ("Frontend", "API")?
4. **Cost tracking**: Should we parse Claude's cost output and show it per-session?
5. **Git integration**: Should tiles show the current git branch of the working directory?
