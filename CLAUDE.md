# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm test                              # Run all tests (node --test test/*.test.js)
node --test test/rollout-parser.test.js  # Run a single test file
npm run ci:local                      # Full local CI (tests + validations + builds)
npm run dashboard:dev                 # Dashboard dev server with local API mock
npm run dashboard:build               # Build dashboard to dashboard/dist/
npm run validate:copy                 # Validate copy registry completeness
npm run validate:ui-hardcode          # Check for hardcoded UI strings
npm run validate:guardrails           # Validate architecture guardrails
node bin/tracker.js serve --no-sync   # Start local dashboard server
```

## Architecture

Token Tracker is a local-first AI token usage tracker. It collects token counts from multiple AI CLI tools via hooks, aggregates locally, and displays in a built-in web dashboard and native macOS menu bar app.

### Data Flow

```
AI CLI Tools → hooks/notify.cjs trigger sync → rollout.js parses logs → queue.jsonl → local API → dashboard
```

### Four Layers

**CLI (`src/`)** — Node.js CommonJS. Entry: `bin/tracker.js` → `src/cli.js` dispatches commands. Default command (no args) runs `serve` which auto-runs `init` on first use, then launches local HTTP server on port 7680.

**Dashboard (`dashboard/`)** — React 18 + Vite 7 + TypeScript + TailwindCSS. Built to `dashboard/dist/` and served by the CLI's `serve` command. In local mode (`localhost`), skips auth and reads data from local API endpoints. Deployed to Vercel at token.rynn.me for cloud mode.

**macOS App (`TokenTrackerBar/`)** — Native Swift 5.9 menu bar app. Embeds a complete Node.js + tokentracker runtime (`EmbeddedServer/`). Hosts the React dashboard via WKWebView and provides native UI panels (usage summary, heatmap, model breakdown, usage limits, Clawd companion). Built with XcodeGen.

**Backend (`insforge/`)** — InsForge Edge Functions for the cloud service. Handles cloud authentication, leaderboard, and data sync. Not needed for local-only usage.

### Supported AI Tools (8 providers)

| Tool | Hook Method | Parser |
|------|------------|--------|
| Claude Code | SessionEnd hook in settings.json | `normalizeClaudeUsage` |
| Codex CLI | TOML notify array in config.toml | Rollout JSONL |
| Cursor IDE | API-based (SQLite auth + CSV fetch) | `normalizeCursorUsage` |
| Gemini CLI | SessionEnd hook in settings.json | `diffGeminiTotals` |
| OpenCode | Plugin system + SQLite DB | `normalizeOpencodeTokens` |
| OpenClaw | Session plugin (modern) | Rollout JSONL |
| Every Code | TOML notify array (same as Codex) | Rollout JSONL |
| Kiro | SQLite + JSONL hybrid | Rollout JSONL |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `serve` | Start local HTTP server on :7680, auto-runs init on first use |
| `init` | Setup wizard: consent → detect CLIs → install hooks → browser auth |
| `sync` | Parse all log sources → queue.jsonl → upload to cloud (if token set) |
| `status` | Display integration status for all AI tools |
| `doctor` | Health check: backend, tokens, queue, hooks |
| `diagnostics` | Export full system state as JSON |
| `uninstall` | Remove all hooks and config |
| `activate-if-needed` | Auto-detect & configure unconfigured AI CLIs |

### Key Source Files — CLI

- `src/lib/rollout.js` (2907 lines) — Core parser. Handles all 8 log formats. Aggregates into 30-minute UTC buckets. Contains per-provider normalizers.
- `src/lib/local-api.js` (951 lines) — Local API handler. Serves 11 endpoints under `/functions/tokentracker-*` and `/api/auth/*`.
- `src/lib/usage-limits.js` (1092 lines) — Rate limit detection via API/CLI introspection for Claude, Codex, Cursor, Gemini, Kiro, Antigravity.
- `src/commands/init.js` (907 lines) — First-time setup. Installs notify.cjs, copies runtime to `~/.tokentracker/app/`, configures hooks for all providers.
- `src/commands/sync.js` (816 lines) — Parses all sources, queues hourly buckets, uploads in batches (max 5 batches × 200 records).
- `src/commands/serve.js` — HTTP server. Port conflict resolution, CORS, SPA fallback.
- `src/lib/cursor-config.js` — Extracts Cursor auth from local SQLite, fetches usage CSV.
- `src/lib/codex-config.js` — Parse/update Codex & Every Code config.toml notify arrays.
- `src/lib/subscriptions.js` — Detect Claude Pro, ChatGPT plans via keychain/API.

### Key Source Files — Dashboard

- `dashboard/src/App.jsx` — Router + auth gate. Localhost → dashboard directly; cloud → requires auth.
- `dashboard/src/pages/DashboardPage.jsx` — Main dashboard (lazy-loaded). Period selector, usage panels, charts.
- `dashboard/src/pages/LeaderboardPage.jsx` — Global token usage rankings with sortable columns.
- `dashboard/src/pages/LandingPage.jsx` — Marketing/onboarding page.
- `dashboard/src/ui/matrix-a/views/DashboardView.jsx` — Main layout orchestrator.
- `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.jsx` — Rate limits display per AI tool.
- `dashboard/src/ui/matrix-a/components/TrendChart.jsx` — Line/bar chart with Motion animations.
- `dashboard/src/ui/matrix-a/components/ActivityHeatmap.jsx` — GitHub-style contribution calendar.
- `dashboard/src/hooks/use-usage-data.ts` — Primary data fetching hook.
- `dashboard/src/lib/api.ts` — HTTP client for local & cloud APIs.
- `dashboard/src/lib/copy.ts` — i18n system reading from `content/copy.csv` (456 strings).
- `dashboard/src/contexts/InsforgeAuthContext.jsx` — Cloud OAuth via InsForge SDK.

### Key Source Files — macOS App

- `TokenTrackerBar/TokenTrackerBarApp.swift` — Entry point. NSApplicationDelegateAdaptor manages StatusBarController, DashboardViewModel, ServerManager.
- `TokenTrackerBar/Services/ServerManager.swift` — Embedded/system Node.js server lifecycle with health check polling.
- `TokenTrackerBar/Services/StatusBarController.swift` — Menu bar popover UI + status icon animation.
- `TokenTrackerBar/Services/DashboardWindowController.swift` — WKWebView hosting React dashboard.
- `TokenTrackerBar/ViewModels/DashboardViewModel.swift` — All dashboard state. Auto-refresh every 5 minutes.
- `TokenTrackerBar/Views/ClawdCompanionView.swift` — Animated pixel art companion with 9 states (DrawCtx + static draw methods).
- `TokenTrackerBar/Views/UsageLimitsView.swift` — Native usage limits display.
- `TokenTrackerBar/Models/LimitsSettingsStore.swift` — UserDefaults persistence for limit preferences.

### Local API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /functions/tokentracker-usage-summary` | Aggregate token totals + 7/30-day rolling stats |
| `GET /functions/tokentracker-usage-daily` | Day-by-day token breakdown |
| `GET /functions/tokentracker-usage-hourly` | Hourly breakdown for selected day |
| `GET /functions/tokentracker-usage-monthly` | Month-by-month trends |
| `GET /functions/tokentracker-usage-heatmap` | Weekly activity grid (52 weeks) |
| `GET /functions/tokentracker-usage-model-breakdown` | Tokens/cost by source + model |
| `GET /functions/tokentracker-project-usage-summary` | Project attribution |
| `GET /functions/tokentracker-usage-limits` | Rate limits & subscription status |
| `GET /functions/tokentracker-user-status` | User status (always pro: true locally) |
| `POST /functions/tokentracker-local-sync` | Trigger sync |
| `GET/POST /api/auth/*` | Proxy to cloud auth |

Query params: `from`, `to` (YYYY-MM-DD), `tz` (timezone), `tz_offset_minutes`, `weeks`, `limit`

### Token Normalization Convention

`input_tokens` = pure non-cached input (no cache_creation/cache_write). `cached_input_tokens` = cache reads. `cache_creation_input_tokens` = cache writes. `total_tokens` = input + output + cache_creation + cache_read (aligned with ccusage). All token types including cache are tracked and included in totals.

### Queue Entry Format

```json
{
  "hour_start": "2026-04-05T14:00:00Z",
  "source": "codex|claude|gemini|opencode|cursor|openclaw|kiro",
  "model": "gpt-5.4|claude-opus-4-6|gemini-2.5-pro|...",
  "input_tokens": 1000,
  "output_tokens": 500,
  "cached_input_tokens": 100,
  "cache_creation_input_tokens": 50,
  "reasoning_output_tokens": 0,
  "total_tokens": 1650,
  "conversation_count": 1
}
```

### Dashboard Tech Stack

- React 18 + React Router 7 + TypeScript 5.9 (strict)
- Vite 7.3 (build), Tailwind CSS 3.4 (styling)
- Motion 12 (animations), Three.js + OGL (3D effects)
- InsForge SDK 1.2 (cloud auth/leaderboard)
- @vercel/analytics + speed-insights
- date-fns (dates), html-to-image (sharing/screenshots)
- Vitest (unit tests), Playwright (E2E)

### Dashboard Features

- **Token usage tracking** — totals, cost estimation, breakdown by time/model/provider/project
- **Usage limits** — rate limit tracking for Claude, Codex, Cursor, Gemini, Kiro, Antigravity
- **Leaderboard** — global token usage rankings with user profiles
- **Activity heatmap** — GitHub-style contribution calendar
- **Trend charts** — line/bar charts with period selector (day/week/month/total/custom)
- **Cost analysis** — modal with per-model pricing breakdown (70+ models)
- **Cloud sync** — one-click sync local usage to cloud via InsForge
- **Data sharing** — screenshot captures + public share links
- **Dark/light theme** — persisted to localStorage
- **Clawd companion** — animated pixel art mascot with 9 animation states
- **Copy system** — CSV-based i18n with 456 strings, validated by `validate:copy`

### macOS App Architecture

- Swift 5.9, macOS 13.0+, XcodeGen project generation
- Menu bar app (LSUIElement: true), single-click → popover, double-click → full dashboard window
- Embedded Node.js server (universal arm64+x64 binary) — self-contained, no external Node dependency
- WKWebView hosts React dashboard with script messaging for OAuth
- Native panels: summary cards, heatmap, model breakdown, usage limits, Clawd companion
- Auto-refresh every 5 minutes, server health check with exponential backoff
- URL scheme: `tokentracker://` for OAuth callbacks

## Conventions

- Package name: `tokentracker-cli` (npm), bin command: `tokentracker`
- CommonJS throughout `src/` (no ESM)
- Dashboard uses TypeScript + ESM
- Environment variable prefix: `TOKENTRACKER_` (e.g., `TOKENTRACKER_DEBUG`, `TOKENTRACKER_DEVICE_TOKEN`)
- Dashboard env prefix: `VITE_` (e.g., `VITE_INSFORGE_BASE_URL`, `VITE_TOKENTRACKER_MOCK`)
- All user-facing text in `dashboard/src/content/copy.csv`
- Platform: macOS-first
- UTC timestamps, half-hour bucket aggregation
- Privacy: token counts only, never prompts or conversation content
- Git commit messages in English, conventional commits style (feat/fix/refactor/chore/ci/docs/test)
- EmbeddedServer is gitignored — built on-demand via `bundle-node.sh`
- XcodeGen project: run `xcodegen generate` then `ruby scripts/patch-pbxproj-icon.rb` after changes to `project.yml`

## Release Workflow

Two artifacts are published per release, both sharing the same version number.

### Version Numbering

- npm (`package.json`) and macOS App (`TokenTrackerBar/project.yml` → `MARKETING_VERSION`) use the same version
- Follow semver: bug fix increments patch

### Version Bump Rules

When a feature or fix is significant enough to ship, **ask the user whether to bump the version**:

- **Dashboard/CLI-only changes** (web UI, parser, API, hooks): bump `package.json` only → npm auto-publishes on push
- **Changes that touch Swift / macOS App**: bump **both** `package.json` and `TokenTrackerBar/project.yml` `MARKETING_VERSION` → npm auto-publishes on push, then trigger DMG workflow

### CI/CD Pipelines (fully automated)

**npm publish** (`.github/workflows/npm-publish.yml`)
- Triggers on every push to `main`
- Checks if current version already exists on npm; skips if so
- Builds dashboard → publishes to npm
- Auth: `NPM_TOKEN` GitHub Secret (encrypted, never exposed in logs or code)

**Release DMG** (`.github/workflows/release-dmg.yml`)
- Triggers manually via `workflow_dispatch` with version input
- Runs on `macos-15` runner in GitHub cloud
- Full pipeline: dashboard build → EmbeddedServer bundle → xcodegen → xcodebuild → DMG → GitHub Release with DMG asset
- No local machine required

### Typical Release Flow

When the user says "release" or "发 release", execute these steps:

1. Bump version in `package.json` (and `TokenTrackerBar/project.yml` if App changed)
2. Commit and push to `main` → npm publishes automatically
3. If App changed: run `gh workflow run "release DMG" -f version=X.Y.Z` → cloud builds DMG + creates GitHub Release

No local build required. No manual GitHub Actions page visit needed.

### Local Build (optional, for testing)

```bash
cd TokenTrackerBar
npm run dashboard:build
./scripts/bundle-node.sh
xcodegen generate
ruby scripts/patch-pbxproj-icon.rb
xcodebuild -scheme TokenTrackerBar -configuration Release clean build
APP_PATH="$(find ~/Library/Developer/Xcode/DerivedData/TokenTrackerBar-*/Build/Products/Release -name 'TokenTrackerBar.app' -maxdepth 1)"
bash scripts/create-dmg.sh "$APP_PATH"
```

### Release Notes Style

One-line English summary, e.g. `Fix token stats inflation caused by duplicate queue entries`. No markdown formatting, no sections.

## Test Suite

96 test files using Node.js built-in test runner (`node --test`). Key areas:

- **Rollout parser** — `test/rollout-parser.test.js` (comprehensive, covers all 8 providers)
- **CLI commands** — init, sync, status, doctor, diagnostics, uninstall
- **Integrations** — codex-config, cursor-config, openclaw, opencode
- **Dashboard** — layout, identity, link codes, auth guards, TypeScript guardrails
- **Models** — model-breakdown, usage-limits, subscriptions, mock data
- **CI/CD** — npm-publish-workflow, release-dmg-workflow, architecture-guardrails
- **Helpers** — `test/helpers/load-dashboard-module.js` for loading ESM dashboard modules in CJS tests

## OpenSpec Workflow

For significant changes (new features, breaking changes, architecture), create a proposal in `openspec/changes/<id>/`. Bug fixes and formatting skip this process.

```bash
openspec list                         # Active changes
openspec list --specs                 # Existing specifications
openspec validate <id> --strict       # Validate proposal
```
