# Contributing to Lantern

Thanks for taking a look. Bug reports, ideas and pull requests are all welcome.

## Getting set up

```bash
pnpm install
pnpm build
node dist/main.js --port 3400
```

You need Node.js 24 or newer and pnpm. `pnpm dev` exists but is not the recommended loop — see below.

To work against fake data instead of your own conversations:

```bash
node dist/main.js --port 4100 --claude-dir ./mock-global-claude-dir
```

## Before you open a pull request

```bash
pnpm gatecheck check
```

That runs formatting, linting, type checking and tests over your diff, and is the same gate CI applies.
Please also run `./scripts/lingui-check.sh` if you touched user-facing strings.

## House rules

These come from the upstream project and still hold:

- **No `as` type casting**, anywhere, including tests. If the types look unsolvable without it, say so
  in the pull request rather than casting around it.
- **Effect-TS for backend side effects.** Use `FileSystem`/`Path`/`Command` from `@effect/platform`
  rather than `node:fs`, `node:path` or `child_process`.
- **Hono RPC + TanStack Query for API calls.** No raw `fetch` in the web app.
- **Prefer pure functions.** Reach for Effect only where you genuinely need side effects or state; pure
  logic is easier to test and most of the interesting code here is pure.
- Write tests alongside the change. The clustering logic in particular is pure and easy to cover.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type: description`.

| Type                               | Use for                                    |
| ---------------------------------- | ------------------------------------------ |
| `feat`                             | A user-facing feature                      |
| `fix`                              | A user-facing bug fix                      |
| `chore`, `ci`, `build`, `refactor` | Internal work, excluded from release notes |

Use `fix` only for things a user would notice. A linter or type error is a `chore`.

## Scope

Lantern is a fork of [claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer) focused on
finding conversations again: topics, cross-project listing, board view. Fixes that belong to the viewer
itself are usually better sent upstream, where everyone benefits — including us.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
