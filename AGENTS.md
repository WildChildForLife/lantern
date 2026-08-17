# AGENTS.md

## Critical Rules (Read First)

**Language**:

- Code, comments, commits in English

**NEVER**:

- Use `as` type casting anywhere, tests included (explain problem to user instead)
- Use raw `fetch` or bypass TanStack Query for API calls
- Run `pnpm dev` or `pnpm start` (dev servers)
- Use `node:fs`, `node:path`, etc. directly (use Effect-TS equivalents)

**ALWAYS**:

- Effect-TS for all backend side effects
- Hono RPC + TanStack Query for all API calls
- TDD: tests first, then implement
- Run `pnpm typecheck` and `pnpm fix` before commit

## Commit Message Rules

Conventional Commits: `type: description`

**Release Note Awareness**:

- Commit messages ship in release notes. Write for users.

**Type Selection**:

| Type                               | Release Note | Purpose                 |
| ---------------------------------- | ------------ | ----------------------- |
| `feat`                             | Features     | User-facing new feature |
| `fix`                              | Bug Fixes    | User-impacting bug fix  |
| `chore`, `ci`, `build`, `refactor` | Excluded     | Internal changes        |

**Critical**: `fix` only for user-facing bugs. Internal fixes (linter errors, type errors, build scripts) use `chore`.

**Message Quality Examples**:

- Bad: `fix: fix lingui error` (internal issue)
- Bad: `feat: add button` (too vague)
- Good: `feat: add dark mode toggle to settings`
- Good: `fix: session list not updating after deletion`
- Good: `chore: update lingui compiled messages`

## Project Overview

Lantern read Claude Code session logs straight from JSONL files (`~/.claude/projects/`), zero data loss. Web client shipped as CLI tool serving Vite app.

**Core Architecture**:

- Frontend: Vite + TanStack Router + React 19 + TanStack Query
- Backend: Hono (standalone server) + Effect-TS (all business logic)
- Data: Direct JSONL reads, strict Zod validation
- Real-time: Server-Sent Events (SSE) for live updates

## Recommended Coding Process

Project aims for fast feedback plus quality (checks pass = runtime correctness near-guaranteed) via:

- Strict typing with Effect-TS and ADT
- Quality constraints pushed into Lint where possible
- Dependency injection and testing with Effect-TS

Implement in t-wada TDD style.

`pnpm gatecheck check` run all above checks against diff at once. Loop: detect problem, fix, repeat.

Gives fast static checks plus unit tests.

## Quality Gate (MUST follow)

After source change, always run before commit:

```bash
pnpm gatecheck check
./scripts/lingui-check.sh
```

## Key Directory Patterns

- `src/server/hono/route.ts` - Hono API routes (all routes here)
- `src/server/core/` - Effect-TS business logic (domain modules: session, project, git, etc.)
- `src/lib/conversation-schema/` - Zod schemas for JSONL validation
- `src/testing/layers/` - Reusable Effect test layers (`testPlatformLayer` is foundation)
- `src/routes/` - TanStack Router routes
- `src/cli/` - Interactive CLI: `init` wizard and `browse` board

### The CLI (`src/cli/`)

`lantern init` and `lantern browse` render terminal UI with Ink (React) while driving backend
Effect services directly, so belong to neither `src/server` nor `src/web`. Sit outside both —
also what module-boundary lint rule expects: it classifies file by whether path contains
`src/server` or `src/web`, gives up otherwise, so `src/cli/**` may import from either side.
Two rules still apply: no `@/` alias outside `src/web`, and tests colocated.

Three things worth knowing before changing it:

- **Behaviour lives in pure functions**, under `browse/functions/`, `actions/planAction.ts` and
  `init/steps.ts`. Components are wiring. Change to what key does, which question comes next
  or how emulator launches belongs in one of those, with test, not in `.tsx`.
- **The read-only layer stack** in `runtime.ts` is subset of `startServer.ts` graph that answers
  questions about conversations, minus anything that listens, watches or schedules.
- **Options must be loaded before the layers are built**, via `LanternOptionsService.withOptions`.
  Services resolving path during construction — source roots, cache file — would otherwise never
  see `--claude-dir`. Server gets away loading them after because it reads per request; command
  that asks one question and exits cannot.

## Coding Standards

### Backend: Effect-TS

**Prioritize Pure Functions**:

- Extract logic into pure, testable functions when possible
- Pure functions easier to test, reason about, maintain
- Use Effect-TS only when side effects or state needed

**Use Effect-TS for Side Effects and State**:

- Mandatory for I/O, async code, stateful logic
- No class-based implementations or mutable variables for state
- Use Effect-TS functional patterns for state
- Reference: https://effect.website/llms.txt

**Testing with Layers**:

```typescript
import { expect, test } from "vitest";
import { Effect } from "effect";
import { testPlatformLayer } from "@/testing/layers";
import { yourEffect } from "./your-module";

test("example", async () => {
  const result = await Effect.runPromise(yourEffect.pipe(Effect.provide(testPlatformLayer)));
  expect(result).toBe(expectedValue);
});
```

**Avoid Node.js Built-ins**:

- `FileSystem.FileSystem` not `node:fs`
- `Path.Path` not `node:path`
- `Command.string` not `child_process`

Enables dependency injection and proper testing.

**Type Safety - NO `as` Casting**:

- `as` casting **strictly prohibited**
- If types seem unsolvable without `as`, explain problem to user and ask for guidance
- Valid alternatives: type guards, assertion functions, Zod schema validation

### Frontend: API Access

**Hono RPC + TanStack Query Only**:

```typescript
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

const { data } = useQuery({
  queryKey: ["example"],
  queryFn: () => api.endpoint.$get().then((res) => res.json()),
});
```

Raw `fetch` and direct requests prohibited.

### Tech Standards

- **Linter/Formatter**: oxlint + oxfmt (not ESLint/Prettier/Biome)
- **Type Config**: `@tsconfig/strictest`
- **Path Alias**: `@/*` maps to `./src/*`

## Architecture Details

### SSE (Server-Sent Events)

**When to Use SSE**:

- Deliver session log updates to frontend
- Notify clients of background process state changes
- **Never** for request-response (use Hono RPC instead)

**Implementation**:

- Server: `/api/sse` endpoint with type-safe events (`TypeSafeSSE`)
- Client: `useServerEventListener` hook for subscriptions

### Data Layer

- **Single Source of Truth**: `~/.claude/projects/*.jsonl`
- **Cache**: `~/.lantern/` (invalidated via SSE when source changes)
- **Validation**: Strict Zod schemas capture every field

### Session Process Management

Claude Code processes stay alive in background (unless aborted), so session continues without changing session-id.

## Development Tips

1. **Session Logs**: Read `~/.claude/projects/` JSONL files to learn data structures
2. **Fixtures**: `fixtures/claude-home/` is fake `~/.claude` dir — demo sessions plus one project per JSONL entry shape. Unit tests read it, and `--claude-dir ./fixtures/claude-home` runs app against it.
3. **Effect-TS Help**: https://effect.website/llms.txt
