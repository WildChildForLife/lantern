# goose, pointed at Ollama's native API.
#
# goose has kept sessions in SQLite since 1.10, so it is here to answer whether
# the read-only SQLite backend reads a second CLI's database as well as
# opencode's — the point of a backend being that it is not one-off.
#
# goose ships a binary rather than an npm package, installed by a script the
# project publishes with each release. That script is fetched from the release
# tag rather than from `stable`, so both halves of the install are pinned: a
# floating script could stop honouring `GOOSE_VERSION` and quietly install
# something else, which would make the compatibility table describe something
# other than what ran. `goose --version` is checked afterwards so the pin is
# enforced rather than merely requested.
#
# The repository moved from block/goose to aaif-goose/goose. The old path still
# redirects, but a redirect stops being a guarantee the moment someone claims
# the vacated name, so the new one is used directly.
FROM debian:stable-slim

ARG GOOSE_VERSION=1.48.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl bzip2 gosu \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 -s /bin/bash agent \
  && curl -fsSL "https://github.com/aaif-goose/goose/releases/download/v${GOOSE_VERSION}/download_cli.sh" \
     | CONFIGURE=false GOOSE_VERSION="v${GOOSE_VERSION}" bash \
  && mv /root/.local/bin/goose /usr/local/bin/goose \
  && chmod 0755 /usr/local/bin/goose \
  && goose --version | grep -q "${GOOSE_VERSION}"

COPY bootstrap.sh /usr/local/bin/bootstrap
COPY entrypoint-goose.sh /usr/local/bin/run-harness
RUN chmod +x /usr/local/bin/run-harness /usr/local/bin/bootstrap

ENTRYPOINT ["/usr/local/bin/run-harness"]
