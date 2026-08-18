# Contributing to Lantern

Thanks for taking a look. Bug reports, ideas and pull requests are all welcome.

## Getting set up

```bash
pnpm install
pnpm build
node dist/main.js --port 3400
```

You need Node.js 24 or newer and pnpm. `pnpm dev` exists but is not the recommended loop, because
session process management shares memory between processes and needs a real build to verify — see
[docs/dev.md](docs/dev.md#the-development-loop).

To work against fake data instead of your own conversations:

```bash
node dist/main.js --port 4100 --claude-dir ./fixtures/claude-home
```

[docs/dev.md](docs/dev.md) covers the architecture, the build, testing and releasing in more depth.

## Before you open a pull request

```bash
pnpm gatecheck check
```

That runs formatting, linting, type checking and tests over your diff, and is the same gate CI applies.

Two things it will not catch, so run them yourself when they apply:

- `pnpm lint` — `gatecheck` only inspects the diff, and `oxfmt` formats Markdown as well as code, so a
  documentation change can pass the gate and still fail CI.
- `./scripts/lingui-check.sh` — if you touched user-facing strings.

## House rules

- **No `as` type casting**, anywhere, including tests. If the types look unsolvable without it, say so
  in the pull request rather than casting around it.
- **Effect-TS for backend side effects.** Use `FileSystem`/`Path`/`Command` from `@effect/platform`
  rather than `node:fs`, `node:path` or `child_process`.
- **Hono RPC + TanStack Query for API calls.** No raw `fetch` in the web app.
- **Prefer pure functions.** Reach for Effect only where you genuinely need side effects or state; pure
  logic is easier to test and most of the interesting code here is pure. `resolveHomeDirectory`,
  `hasRusptyBinary` and `resolveBindHostname` are the shape to copy: a plain function, a file of its
  own, and a test for each branch.
- **Write tests alongside the change.** The clustering logic in particular is pure and easy to cover.
- **Read from the source adapters, never from a hard-coded path.** Lantern reads Claude Code, Codex
  CLI, opencode, Qwen Code, GitHub Copilot CLI and goose. Anything that assumes one of them is a bug.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type: description`.

| Type                               | Use for                                    |
| ---------------------------------- | ------------------------------------------ |
| `feat`                             | A user-facing feature                      |
| `fix`                              | A user-facing bug fix                      |
| `chore`, `ci`, `build`, `refactor` | Internal work, excluded from release notes |

Use `fix` only for things a user would notice. A linter or type error is a `chore`.

Commit messages become the release notes, so write the description for someone reading the changelog
rather than the diff.

## Releasing

Push a `v*` tag and the workflow does the rest: container images, the npm package, the release notes,
and the Homebrew formula. The tag has to match the `version` in `package.json` or the build refuses to
run.

[`packaging/README.md`](packaging/README.md) covers the parts that need a human, and which secrets
each channel needs. The Debian, RPM and AUR channels were retired after v0.3.0.

## Scope

Lantern is focused on finding conversations again: topic grouping, cross-project listing and the
board view. Changes that make those better are the easiest to get merged.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
