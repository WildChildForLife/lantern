# Packaging

How Lantern reaches each channel, and which steps a human still has to run.

Every channel installs the same thing: the npm tarball — the built application
plus its production dependencies. There is one artifact, published once, behind
three front doors.

## What is automated

The release workflow runs on a `v*` tag and needs nothing but the tag.

| Channel             | Artifact                                   | Automated |
| ------------------- | ------------------------------------------ | --------- |
| npm                 | `lantern-viewer`                           | yes¹      |
| Container (ghcr.io) | `linux/amd64`, `linux/arm64` images        | yes       |
| Homebrew            | formula in `WildChildForLife/homebrew-tap` | yes²      |

¹ Published over OIDC against the trusted publisher configured for
`lantern-viewer` on npm, from the workflow's `release` environment. No token is
stored in this repository, and there is deliberately no `NODE_AUTH_TOKEN`
fallback. A prerelease version goes to the `next` dist-tag; only a release takes
`latest`.

² Automated, but only when `TAP_GITHUB_TOKEN` is set — `GITHUB_TOKEN` cannot reach
another repository. Without it the release still succeeds and the run summary says
the formula was left behind.

The GitHub release itself carries notes and nothing else: npm and ghcr.io are
where the artifacts live.

## After a release: Homebrew

The formula installs from the npm tarball, so it can only be bumped once the npm
job has published. Refresh the version and checksum:

```bash
scripts/bump-tap.sh 0.4.0
```

Then publish it.

### Homebrew

The release workflow does this. The `homebrew` job runs after `npm` — the formula
installs from the npm tarball, so it can only be bumped once that exists — points
`packaging/homebrew/lantern-viewer.rb` at the new version, and pushes it to
`WildChildForLife/homebrew-tap` as `Formula/lantern-viewer.rb`.

It needs a `TAP_GITHUB_TOKEN` secret, because `GITHUB_TOKEN` is scoped to this
repository alone. Use a **fine-grained** personal access token:

- Resource owner: `WildChildForLife`
- Repository access: only `WildChildForLife/homebrew-tap`
- Permissions: **Contents → Read and write**
- Expiration: set one, and diarise the renewal

```bash
gh secret set TAP_GITHUB_TOKEN --repo WildChildForLife/lantern
```

Without the secret the job still runs, skips the push, and writes a note to the
run summary — a stale formula is worth less than a failed release. To do it by
hand in that case:

```bash
scripts/bump-tap.sh 0.2.0
git clone https://github.com/WildChildForLife/homebrew-tap
cp packaging/homebrew/lantern-viewer.rb homebrew-tap/Formula/lantern-viewer.rb
cd homebrew-tap && git commit -am "lantern-viewer 0.2.0" && git push
```

Users then install with:

```bash
brew install wildchildforlife/tap/lantern-viewer
```

## Where each channel puts things

`src/cli/upgrade/installSource.ts` classifies an install by these paths, so a
change here is a change there.

| Channel   | Lantern lives in                                     | Upgraded by                    |
| --------- | ---------------------------------------------------- | ------------------------------ |
| npm       | `<prefix>/lib/node_modules/lantern-viewer`           | `lantern upgrade`              |
| Homebrew  | `<brew prefix>/Cellar/lantern-viewer/<version>`       | `brew upgrade lantern-viewer`  |
| Container | `/app` inside the image                              | pulling a newer image          |

## Retired channels

The `.deb`, `.rpm` and AUR packages were dropped after v0.4.0, which is the last
release that carries them. They existed to save users installing Node by hand,
and did the opposite: the packages declare `nodejs (>= 24)`, every current
Debian and Ubuntu ships an older `nodejs`, and apt refuses the install outright
rather than pulling a newer Node in. The deb and rpm trees were also not the npm
tree — `@anthropic-ai/claude-code` was stripped from them to stay under a size
ceiling — so the three channels shipped materially different installs.

`lantern upgrade` recognises the `/usr/lib/lantern` layout those packages used
and tells whoever is still on one how to move to npm. That message is why v0.4.0
had to ship the command *and* the packages: somebody running a `.deb` only ever
runs code that came in the `.deb`.

One note worth keeping from the workflow that attached those packages to the
release: GitHub skips a job when anything in its **transitive** dependency chain
failed, not merely its direct `needs`. An asset job downstream of the npm job was
silently skipped when npm publishing failed, and v0.1.0 was published with no
packages attached. Anything added later that attaches artifacts needs
`if: always()` plus explicit `needs.<job>.result` checks to re-impose the gating
that `always()` removes.
