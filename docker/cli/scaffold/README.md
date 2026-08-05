# Scaffolded CLIs

Lantern cannot read these yet. Each has a Dockerfile and a config recipe so
that PR-8 and PR-9 begin from a container that runs, rather than from a guess
about a format — which is the mistake this whole harness exists to stop repeating.

To bring one live: add a service to `../../compose.yaml` copying the shape of
`opencode`, mount its history directory as a named volume, mount that same
volume into `lantern`, and add the source id to the `sources.json` seed in
`../../run.sh`.

| CLI         | Points at Ollama via                                                           | Writes history to                                               |
| ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Copilot CLI | `COPILOT_PROVIDER_TYPE=openai` + `COPILOT_PROVIDER_BASE_URL` + `COPILOT_MODEL` | `~/.copilot/session-state/<id>/events.jsonl`                    |
| goose       | `GOOSE_PROVIDER=ollama` + `OLLAMA_HOST` + `GOOSE_MODEL`                        | `~/.local/share/goose/sessions/sessions.db` (SQLite since 1.10) |

Both of those paths are still **descriptions, not observations**. Qwen Code's
was too, and it was wrong: this table used to claim `~/.qwen/tmp/<hash>/`, and
the CLI actually writes `~/.qwen/projects/<encoded-cwd>/chats/<uuid>.jsonl`.
Drive them before believing them.

Two things to establish before building on any of them:

- **Copilot CLI** may still require a GitHub subscription to launch even in BYOK
  mode. Untested. If it does, PR-8 cannot be verified this way.
- **goose** stores sessions in SQLite, so it needs the read-only SQLite backend
  from PR-9 before Lantern can read it at all. Its `GOOSE_TOOLSHIM=1` converts
  tool definitions to text prompts and parses the replies back, which is the
  only mitigation in any of these CLIs for a small model that will not emit
  tool calls natively.

Not scaffolded, and why:

- **Gemini CLI** cannot be pointed at a non-Google model. No `base_url`, no
  OpenAI-compatible auth type; the multi-provider issues upstream are open and
  unresolved. It was assumed Qwen Code could stand in for it, being a fork —
  driving Qwen Code showed the two formats have almost nothing in common, so
  Gemini CLI still has no observed data and no adapter. See
  `../../compatibility.md` for the comparison.
- **cursor-agent** — every account of pointing Cursor at a local model describes
  the IDE, not the CLI. Unverified, so not promised.
