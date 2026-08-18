# Lantern documentation

Start at the [README](../README.md) for what Lantern is and how to install it.

## Using Lantern

| Document                          | Covers                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Install](install.md)             | npm, Homebrew, Docker, Windows, from source, and per-platform support       |
| [The board](board.md)             | `lantern browse` — keys, resuming, sorting into topics                      |
| [The web UI](web-ui.md)           | What the server gives you that the terminal does not                        |
| [Configuration](configuration.md) | The setup wizard, every option, and how a setting is resolved               |
| [Agent CLIs](agents.md)           | The six CLIs Lantern reads, where their history lives, multi-machine setups |
| [How grouping works](grouping.md) | Local keyword clustering, and the optional AI naming pass                   |

## Contributing

| Document                                              | Covers                                                |
| ----------------------------------------------------- | ----------------------------------------------------- |
| [CONTRIBUTING.md](../CONTRIBUTING.md)                 | Setup, the quality gate, house rules, commit messages |
| [Developing Lantern](dev.md)                          | Architecture, the build, testing, i18n, releasing     |
| [AGENTS.md](../AGENTS.md)                             | The same conventions, written for coding agents       |
| [docker/README.md](../docker/README.md)               | The harness that drives real agent CLIs in containers |
| [docker/compatibility.md](../docker/compatibility.md) | Which CLI versions were verified, and what turned up  |
| [packaging/README.md](../packaging/README.md)         | Release channels and the steps that need a human      |

### House guidelines

- [Commit messages](guidelines/commit_message.md)
- [Branch naming](guidelines/branch_naming.md)
- [Definition of done](guidelines/definition_of_done.md)
- [Internal review](guidelines/internal_review.md)
- [QA](guidelines/qa_guideline.md)

## Policies

- [SECURITY.md](../SECURITY.md) — threat model, what a running instance exposes, reporting a
  vulnerability
- [PRIVACY.md](../PRIVACY.md) — what leaves your machine, and when
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
