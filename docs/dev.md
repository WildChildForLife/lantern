# Developing Lantern

How the project is put together and how to work on it. [CONTRIBUTING.md](../CONTRIBUTING.md) covers
the house rules and what to run before opening a pull request; [AGENTS.md](../AGENTS.md) is the same
material written for coding agents.

## Requirements

- **Node.js** 24 or newer — see [.node-version](../.node-version)
- **pnpm** — the version in `package.json`'s `packageManager` field (currently 11.0.9); Corepack
  installs it for you

```bash
pnpm install
```

That also installs the git hooks, via `lefthook install` in the `prepare` script.

## The development loop

The recommended loop is a build and run, not a dev server:

```bash
pnpm build
node dist/main.js --port 3400          # web UI and board together
node dist/main.js --server-only        # web UI alone
node dist/main.js --cli-only           # terminal board alone
```

`pnpm dev` exists and runs both halves in parallel with `run-p` — Vite for the frontend on
`DEV_FE_PORT` (3400), and `node --watch src/server/main.ts --server-only` for the backend on `DEV_BE_PORT` (3401),
with `/api` proxied from the first to the second. It is fine for frontend work, but session process
management shares memory between processes, so anything touching that needs verifying against a real
build.

To work against the bundled fixtures instead of your own conversations:

```bash
node dist/main.js --cli-only --claude-dir ./fixtures/claude-home
node dist/main.js --server-only --port 4100 --claude-dir ./fixtures/claude-home
```

The fixture conversations record invented working directories, so the board will refuse to resume
any of them — that refusal is correct behaviour, not a fault. Point it at your own history to
exercise resuming.

The board and `init` are built with React (Ink), so their sources are `.tsx` and Node cannot run them
directly: `node src/server/main.ts` fails on the file extension as soon as it reaches for the board.
Build first — `pnpm build:backend` is enough and takes about a second. `--server-only` never loads
Ink, so that one runs from source.

## The build

`pnpm build` runs [`scripts/build.sh`](../scripts/build.sh), which is three steps after clearing
`dist/`:

1. `pnpm lingui:compile` — compile the i18n catalogues
2. `pnpm build:backend` — bundle the backend and CLI with **tsdown** → `dist/main.js`
3. `pnpm build:frontend` — build the frontend with **Vite** → `dist/static/`

```text
dist/
├── main.js          # backend server + CLI entry point
├── main.js.map
└── static/          # Vite output
    ├── index.html
    └── assets/
```

One process serves the static files and the API on a single port (3000 by default, `PORT` to change
it). `dist/main.js` is the `lantern` binary in `package.json`'s `bin` field.

## Quality gate

```bash
pnpm gatecheck check
```

`gatecheck` runs formatting, linting, type checking and tests **over your diff**, which is the fast
loop. Two things it will not catch:

- `pnpm lint` — gatecheck only inspects the diff, and `oxfmt` formats Markdown as well as code, so a
  documentation-only change can pass the gate and still fail CI.
- `./scripts/lingui-check.sh` — if you touched user-facing strings.

Individually:

| Command          | Tool                                   | Notes                                       |
| ---------------- | -------------------------------------- | ------------------------------------------- |
| `pnpm lint`      | oxlint + oxfmt (check)                 | config in `.oxlintrc.json`, `.oxfmtrc.json` |
| `pnpm fix`       | oxlint `--fix` + oxfmt (write)         | run this before committing                  |
| `pnpm typecheck` | `tsgo --noEmit`, `@tsconfig/strictest` |                                             |
| `pnpm test`      | Vitest, single run                     | `pnpm test:watch` to iterate                |

Two lint rules carry house policy: `no-unsafe-type-assertion` enforces the no-`as` rule, and
`no-process-env` keeps environment access behind the platform layer. e2e and config files have
relaxed rules.

### Git hooks

[`lefthook.yml`](../lefthook.yml) wires them up:

- **pre-commit** — gitleaks secret scan, plus `oxlint --fix` and `oxfmt` over the staged files, with
  fixes restaged
- **pre-push** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the lingui checks including a
  guard that compiled catalogues are committed

### CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs lint, typecheck and tests, the two
i18n checks, a compile-and-diff check on the catalogues, then packs the tarball
(`scripts/pack/check.sh`) and installs it globally on a clean machine and boots it
(`scripts/pack/smoke.sh`). CodeQL runs from its own workflow. CI is Linux only; macOS and Windows are
verified by hand.

## Architecture

### Frontend — `src/web/`

Vite + TanStack Router, React 19, Radix UI and Tailwind CSS. Jotai for global state, TanStack Query
for server state. All API calls go through Hono RPC (`src/web/lib/api/`) — no raw `fetch`.

### Backend — `src/server/`

Hono with `@hono/node-server`, and Effect-TS for everything with a side effect:

- Services are provided through Effect Context, so dependencies are injected rather than imported
- Controller → Service layering, each layer an Effect
- Typed errors, no thrown exceptions across a boundary
- Node built-ins are reached through `FileSystem.FileSystem`, `Path.Path` and `Command.string`, which
  is what makes them testable

`src/server/core/` holds one directory per domain: `session`, `project`, `source`, `sync`, `search`,
`git`, `scheduler`, `rate-limit`, `terminal`, `tasks`, `events`, `platform` and others.

### The CLI — `src/cli/`

`browse`, `init` and `upgrade`, built with Ink and React. `src/cli/browse/` is the board,
`src/cli/ui/` the shared prompts and theme.

### Data

The single source of truth is whatever the agent CLIs wrote — Claude Code's `~/.claude/projects/`
JSONL, and the equivalents for the other five. Nothing is ever written back to them; the mounts in
the Docker examples are read-only for that reason.

One adapter per CLI lives in `src/server/core/source/adapters/` (`claude-code`, `codex`, `opencode`,
`qwen-code`, `copilot`, `goose`). Anything that assumes a specific CLI outside its adapter is a bug.
Conversation JSONL is validated with Zod schemas in `src/lib/conversation-schema/`, written to capture
every field rather than the subset currently rendered.

Derived state — session lists, project metadata, search indexes — is cached in a **SQLite** database
under `~/.lantern/`, through Drizzle (`src/server/lib/db/`, schema in `schema.ts`, migrations
alongside). Read paths into other CLIs' own SQLite stores go through
`src/server/core/source/functions/readOnlySqlite.ts`. The cache is disposable: delete `~/.lantern/`
and it rebuilds.

### Real-time updates

Server-Sent Events on `/api/sse`. `TypeSafeSSE` gives each event kind a checked payload via
`SSEEventDeclaration`; `SSEController` subscribes to the EventBus and broadcasts. Event kinds:
`connect`, `heartbeat`, `sessionListChanged`, `sessionChanged`, `sessionProcessChanged`,
`permissionRequested`. The client subscribes with the `useServerEventListener` hook. SSE is for
pushing changes only — request/response belongs on Hono RPC.

### Session processes

A Claude Code session stays alive in the background unless it is explicitly aborted, so a paused
session continues without a new session id and without resuming. Because that relies on memory shared
between processes, verify changes here against a production build rather than `pnpm dev`.

## Testing

Vitest, configured in [`vitest.config.ts`](../vitest.config.ts): globals on, setup file
`src/testing/setup/vitest.setup.ts`, `@` aliased to `src/`. Coverage is concentrated on
`src/server/core/`, where the interesting logic is.

Effect code is tested by providing a layer. `testPlatformLayer` in `src/testing/layers/` is the
foundation:

```typescript
import { Effect } from "effect";
import { expect, test } from "vitest";
import { testPlatformLayer } from "@/testing/layers";
import { yourEffect } from "./your-module";

test("example", async () => {
  const result = await Effect.runPromise(yourEffect.pipe(Effect.provide(testPlatformLayer)));
  expect(result).toBe(expectedValue);
});
```

Pure functions are preferred over Effect wherever state and I/O are not genuinely needed —
`resolveHomeDirectory`, `hasRusptyBinary` and `resolveBindHostname` are the shape to copy: a plain
function, a file of its own, and a test per branch.

`fixtures/claude-home/` is a fake `~/.claude` — demo sessions plus one project per JSONL entry shape.
The unit tests read it, and `--claude-dir ./fixtures/claude-home` runs the app against it. There are
sibling fixture homes for the other CLIs (`fixtures/codex-home/`, `fixtures/copilot-home/` and so on).

## Internationalisation

Lingui, with catalogues in `src/lib/i18n/locales/` for `en`, `es`, `fr`, `ja`, `pt` and `zh_CN`.

```bash
pnpm lingui:extract    # pull new strings out of the source
pnpm lingui:compile    # compile catalogues (also part of the build)
./scripts/lingui-check.sh
```

Compiled catalogues are committed, and CI fails if compiling produces a diff. The terminal board is
English only.

## Living against real CLIs

[`docker/README.md`](../docker/README.md) documents the local harness that installs each supported
agent CLI in a container, drives it against a local Ollama model, and reads back what it wrote.
[`docker/compatibility.md`](../docker/compatibility.md) records the versions verified that way and what
each run turned up — that is where the "Verified against" column in
[Agent CLIs](agents.md) comes from.

## Releasing

Push a `v*` tag matching `version` in `package.json`. The workflow builds the container images,
publishes to npm, writes the release notes and updates the Homebrew formula.
[`packaging/README.md`](../packaging/README.md) covers the parts that need a human and the secrets
each channel needs.

## Debugging notes

- **SSE** — watch the connection in the browser's Network tab
- **Log shapes** — read the JSONL under `~/.claude/projects/` directly; it is the actual contract
- **Effect-TS** — the [official docs](https://effect.website/), and `llms.txt` for agent use
