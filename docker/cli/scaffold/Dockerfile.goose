# goose — scaffold for PR-9. Not wired into compose.yaml yet.
#
# Needs the read-only SQLite backend first: goose has stored sessions in
# sessions.db since 1.10, not as files.
FROM debian:stable-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl bzip2 \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash

ENV PATH="/root/.local/bin:${PATH}"

# GOOSE_PROVIDER=ollama
# OLLAMA_HOST=http://ollama:11434
# GOOSE_MODEL=qwen3:0.6b
#
# There is no OS keyring in a container, so configure by env var, not config.yaml.
# GOOSE_TOOLSHIM=1 (with GOOSE_TOOLSHIM_OLLAMA_MODEL) turns tool definitions into
# text prompts and parses the replies back — the only mitigation among these
# CLIs for a small model that will not tool-call natively.
#
# History: ~/.local/share/goose/sessions/sessions.db. Headless: `goose run "..."`.
ENTRYPOINT ["goose"]
