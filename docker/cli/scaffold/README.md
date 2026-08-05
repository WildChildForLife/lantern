# Scaffolded CLIs

Lantern cannot read this one yet. It has a Dockerfile and a config recipe so
that PR-9 begins from a container that runs, rather than from a guess about a
format — which is the mistake this whole harness exists to stop repeating.

To bring one live: add a service to `../../compose.yaml` copying the shape of
`opencode`, mount its history directory as a named volume, mount that same
volume into `lantern`, and add the source id to the `sources.json` seed in
`../../run.sh`.

| CLI   | Points at Ollama via                                    | Writes history to                                               |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------- |
| goose | `GOOSE_PROVIDER=ollama` + `OLLAMA_HOST` + `GOOSE_MODEL` | `~/.local/share/goose/sessions/sessions.db` (SQLite since 1.10) |

That path is still a **description, not an observation**. Two of these have now
been driven and both descriptions were wrong: Qwen Code's said
`~/.qwen/tmp/<hash>/` when the CLI writes
`~/.qwen/projects/<encoded-cwd>/chats/<uuid>.jsonl`, and Copilot CLI's named
only `events.jsonl` when the CLI also keeps a SQLite index beside it. Drive it
before believing it.

One thing to establish before building on goose:

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
