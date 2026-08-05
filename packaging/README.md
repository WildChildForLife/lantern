# Packaging

How Lantern reaches each channel, and which steps a human still has to run.

Every channel installs the same thing: the built application plus its production
dependencies, with **Node declared as a package dependency**. Someone installing
Lantern never installs a runtime by hand — their package manager already did.

## What is automated

The release workflow runs on a `v*` tag and needs nothing but the tag.

| Channel              | Artifact                                   | Automated |
| -------------------- | ------------------------------------------ | --------- |
| Container (ghcr.io)  | `linux/amd64`, `linux/arm64` images        | yes       |
| npm                  | `lantern-viewer`                           | yes¹      |
| Debian / Ubuntu      | `lantern_<version>_{amd64,arm64}.deb`      | yes       |
| Fedora / RHEL / SUSE | `lantern-<version>-1.{x86_64,aarch64}.rpm` | yes       |
| Homebrew             | formula in `WildChildForLife/homebrew-tap` | no²       |
| Arch (AUR)           | `PKGBUILD`                                 | no²       |

¹ Needs an `NPM_TOKEN` (or `AUTH_TOKEN`) repository secret. Without it that one
job fails and the rest of the release still completes.

² Both live in repositories this one cannot push to. See below.

The `.deb` and `.rpm` files are attached to the GitHub release, so there is no
apt or dnf repository to host and nothing to sign.

## After a release: Homebrew and AUR

Both recipes install from the npm tarball, so they can only be bumped once the
npm job has published. Refresh the version and checksum in both:

```bash
scripts/bump-tap.sh 0.1.0
```

Then publish each.

### Homebrew

Requires the tap repository `WildChildForLife/homebrew-tap` with the formula at
`Formula/lantern.rb`.

```bash
git clone https://github.com/WildChildForLife/homebrew-tap
cp packaging/homebrew/lantern.rb homebrew-tap/Formula/lantern.rb
cd homebrew-tap && git commit -am "lantern 0.1.0" && git push
```

Users then install with:

```bash
brew install wildchildforlife/tap/lantern
```

To automate this, add a personal access token with `contents: write` on the tap
repository as a secret and push from the release workflow. `GITHUB_TOKEN` cannot
do it — it is scoped to this repository only.

### AUR

Requires an AUR account with a registered SSH key. This cannot be automated from
CI without putting that key in a secret.

```bash
git clone ssh://aur@aur.archlinux.org/lantern.git aur-lantern
cp packaging/aur/PKGBUILD aur-lantern/
cd aur-lantern
makepkg --printsrcinfo > .SRCINFO   # required by the AUR
git commit -am "lantern 0.1.0" && git push
```

`.SRCINFO` is generated rather than committed from here, because `makepkg` is the
only thing that writes it correctly and it does not run on macOS.

## Building the Linux packages locally

`nfpm` does the packaging. With it on `PATH`:

```bash
pnpm build
scripts/build-packages.sh 0.1.0 amd64
```

Without it, run the same recipe through Docker:

```bash
pnpm build
scripts/build-packages.sh 0.1.0 amd64 || true   # stages, then fails at nfpm
cd packaging && docker run --rm -v "$PWD:/w" -w /w \
  -e VERSION=0.1.0 -e PKG_ARCH=amd64 goreleaser/nfpm \
  package --config nfpm.yaml --packager deb --target ./dist
```

Build on Linux when the package is meant for release. The `amd64` package carries
`@replit/ruspty`'s `linux-x64` build, which keeps the in-app terminal working, and
that binary only resolves when the dependency tree is installed on Linux x64.
Cross-building from macOS silently omits it. The `arm64` package has no such
binary either way — ruspty publishes none for `linux/arm64`, which is why the
terminal is unavailable there.

## Layout the packages install

```
/usr/bin/lantern            launcher, execs node against the line below
/usr/lib/lantern/dist/      the built application
/usr/lib/lantern/node_modules/  production dependencies
```
