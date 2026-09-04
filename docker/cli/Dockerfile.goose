# goose, pointed at Ollama's native API.
#
# goose has kept sessions in SQLite since 1.10, so it is here to answer whether
# the read-only SQLite backend reads a second CLI's database as well as
# opencode's — the point of a backend being that it is not one-off.
#
# The installer lives in the `stable` release of aaif-goose/goose, which is
# where the project moved from block/goose. `GOOSE_VERSION` pins the binary it
# fetches; without it the script takes whatever `stable` points at today, and a
# floating version would make the compatibility table describe something other
# than what ran.
FROM debian:stable-slim

ARG GOOSE_VERSION=1.48.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl bzip2 gosu \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 -s /bin/bash agent \
  && curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
     | CONFIGURE=false GOOSE_VERSION="v${GOOSE_VERSION}" bash \
  && mv /root/.local/bin/goose /usr/local/bin/goose \
  && chmod 0755 /usr/local/bin/goose

COPY bootstrap.sh /usr/local/bin/bootstrap
COPY entrypoint-goose.sh /usr/local/bin/run-harness
RUN chmod +x /usr/local/bin/run-harness /usr/local/bin/bootstrap

ENTRYPOINT ["/usr/local/bin/run-harness"]
