# Local CLI harness

Runs the agent CLIs Lantern reads — for real — and points Lantern at the
histories they write.

This is **not** the deployment stack. That is `../docker-compose.yml`. This one
is a test rig.

```bash
./run.sh
```

First run downloads a ~2.5 GB model and builds four images. After that it is
fast, because the model lives in a named volume.

---

## Why this exists

Every source adapter in Lantern was written against hand-authored fixtures,
because none of these CLIs was installed on the machine they were written on.
Twice that shipped a format that does not exist:

- the Codex adapter was validated against a `session_index.jsonl` fixture whose
  schema was invented, and it had to be deleted;
- the opencode adapter modelled only one of opencode's two storage layouts, so
  every session of an older install would have rendered blank.

Both were the same mistake: **a format assumed rather than observed.** A fixture
can only ever confirm what its author already believed. This harness produces
histories that were written by the CLIs themselves, which is the only kind that
can contradict you.

## What it does

```
ollama            one local model, serving both wire formats the CLIs need
  ├── claude-code   ANTHROPIC_BASE_URL  → /v1/messages
  ├── codex         base_url            → /v1/chat/completions (or /v1/responses)
  └── opencode      baseURL             → /v1/chat/completions
                          │
                          ▼
                    named volumes
                          │
                          ▼
                      lantern            mounts all three, reads what they wrote
```

Each CLI is driven non-interactively through the prompts in `prompts/` against
the small repo in `workspace/`. The prompts are chosen to produce a transcript
with a tool call and its result in it, because that is the part hand-written
fixtures are least likely to have got right.

**No API keys and no network egress.** Ollama serves the OpenAI _and_ Anthropic
dialects natively, so there is no gateway and no credential anywhere in this
stack. The `ANTHROPIC_AUTH_TOKEN=ollama` you will see in `compose.yaml` is
required by the client and ignored by the server — it is not a secret.

> Claude Code subscription credentials are deliberately **not** used to drive
> the other CLIs. Anthropic restricts those tokens to Claude Code itself. A
> local model sidesteps the question entirely.

## Usage

```bash
./run.sh                # drive every CLI, then serve Lantern
./run.sh --drive-only   # generate histories, don't start Lantern
./run.sh --no-drive     # serve Lantern against last run's histories

docker compose -f compose.yaml logs -f lantern
docker compose -f compose.yaml down       # stop
docker compose -f compose.yaml down -v    # stop and discard the model too
```

Override the model or port in a `.env` next to `compose.yaml` — see
`.env.example`. The model **must support tool calling**, or the agents produce
no `tool_use` entries and the more interesting half of each adapter goes
untested.

## Inspecting what was produced

```bash
# What each CLI actually wrote
docker run --rm -v lantern-harness_claude_home:/d alpine   find /d -name '*.jsonl'
docker run --rm -v lantern-harness_codex_home:/d alpine    find /d -name 'rollout-*.jsonl'
docker run --rm -v lantern-harness_opencode_home:/d alpine find /d -path '*opencode*' -name '*.json'

# What Lantern made of it
curl -s localhost:3410/api/sources | jq '.sources[] | {id, supported, stats}'
```

Comparing those files against `../fixtures/` is the point of the exercise. Where
they disagree, the fixture is probably wrong.

See [`compatibility.md`](compatibility.md) for exactly which versions have been
verified, and what the first run found.

## Status per CLI

| CLI          | State            | Notes                                                                                                                               |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code  | live             | Lantern reads it                                                                                                                    |
| Codex        | live             | Lantern reads it                                                                                                                    |
| opencode     | driven, not read | Runs and writes history, but `1.18.13` stores it in SQLite, which Lantern does not read yet — see `compatibility.md`                |
| Qwen Code    | live             | Lantern reads it. Takes any OpenAI-compatible endpoint, which is why it can be driven here at all                                   |
| Copilot CLI  | live             | Lantern reads it. BYOK needs no Copilot subscription — established by this harness, see `compatibility.md`                          |
| goose        | scaffold         | `cli/scaffold/`, for PR-9. Native Ollama provider, and a tool-shim for weak local models                                            |
| cursor-agent | not scaffolded   | Whether the CLI (as opposed to the IDE) can use a local model is unverified                                                         |
| Gemini CLI   | not scaffolded   | Cannot be pointed at a non-Google model at all, so it cannot be driven here. Not Qwen Code's format either — see `compatibility.md` |

The scaffolded CLI has a Dockerfile and an entrypoint but no compose service.
It exists so PR-9 starts from something that runs rather than a guess.

## Known sharp edges

- **opencode `1.18.13` writes SQLite, not JSON files.** Found by this harness on
  its first run, contradicting every secondary description of the 1.x line.
  Lantern reads the JSON layout, so it reads nothing from a current opencode
  install and says so (`sqlite-storage`). Reading it properly needs PR-9.
- **Codex reserves the provider ids `openai`, `ollama` and `lmstudio`.** A
  `config.toml` block using one of them is _silently discarded_ and Codex keeps
  talking to `localhost` — which inside a container is nothing. The harness uses
  the id `harness` for that reason.
- **`codex exec` does persist a rollout** — verified. Its `session_meta` line is
  ~21 KB, larger than the window the adapter reads to identify a session, which
  is why that window grows rather than being fixed.
- **Small models are unreliable at tool calling.** If transcripts come out
  without tool calls, raise the model size before suspecting the adapters.
- **"Sort N new" will not classify anything on the default model.** Topic naming
  asks the CLI for a JSON array covering forty conversations at once, and a
  0.6B model cannot hold that shape — it answers, but not in a form anything can
  parse. The plumbing is still exercised: the CLI is resolved, run headlessly
  and its structured output parsed. To see it actually name topics, set
  `OLLAMA_MODEL` to something larger in `.env`.
