# typed: true
# frozen_string_literal: true

# Formula for the Homebrew tap at WildChildForLife/homebrew-tap.
#
# This copy is the source of truth; scripts/bump-tap.sh rewrites the version and
# checksum from a published npm release and copies it into the tap repository.
#
# Node arrives as a formula dependency, so `brew install` pulls the runtime and
# the user never installs one by hand.
class Lantern < Formula
  desc "Self-hosted dashboard for your agent CLI sessions, grouped by topic"
  homepage "https://github.com/WildChildForLife/lantern"
  url "https://registry.npmjs.org/lantern-viewer/-/lantern-viewer-0.1.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/lantern --version")

    # Reading an empty directory must still answer, which exercises the server
    # rather than only the version string.
    (testpath/"claude/projects").mkpath
    port = free_port
    pid = spawn bin/"lantern", "--port", port.to_s, "--claude-dir", testpath/"claude"
    begin
      sleep 5
      assert_match "<!doctype html", shell_output("curl -fsS http://localhost:#{port}/").downcase
    ensure
      Process.kill "TERM", pid
      Process.wait pid
    end
  end
end
