import { describe, expect, test } from "vitest";
import {
  type ClaudeInstallEnv,
  claudeInstallLocations,
  orderNodeVersionDirectories,
  versionRootCandidates,
} from "./claudeInstallLocations.ts";

const posixJoin = (...segments: string[]) => segments.join("/");

const env = (overrides?: Partial<ClaudeInstallEnv>): ClaudeInstallEnv => ({
  home: "/home/user",
  platform: "linux",
  nvmDir: undefined,
  fnmDir: undefined,
  voltaHome: undefined,
  pnpmHome: undefined,
  xdgDataHome: undefined,
  appData: undefined,
  ...overrides,
});

describe("claudeInstallLocations", () => {
  test("looks in the directories the Claude Code installers write to", () => {
    const { files } = claudeInstallLocations(env(), posixJoin);

    expect(files).toContain("/home/user/.claude/local/claude");
    expect(files).toContain("/home/user/.local/bin/claude");
  });

  test("prefers a home install over a system one", () => {
    const { files } = claudeInstallLocations(env(), posixJoin);

    expect(files.indexOf("/home/user/.local/bin/claude")).toBeLessThan(
      files.indexOf("/usr/local/bin/claude"),
    );
  });

  test("expands every node version a version manager keeps", () => {
    const { versionRoots } = claudeInstallLocations(env(), posixJoin);

    expect(versionRoots).toContainEqual({
      dir: "/home/user/.nvm/versions/node",
      binSegments: ["bin"],
    });
    expect(versionRoots).toContainEqual({
      dir: "/home/user/.local/share/fnm/node-versions",
      binSegments: ["installation", "bin"],
    });
    expect(versionRoots).toContainEqual({
      dir: "/home/user/.asdf/installs/nodejs",
      binSegments: ["bin"],
    });
  });

  test("honours the variables the version managers export", () => {
    const { versionRoots } = claudeInstallLocations(
      env({ nvmDir: "/opt/nvm", fnmDir: "/opt/fnm" }),
      posixJoin,
    );

    expect(versionRoots).toContainEqual({ dir: "/opt/nvm/versions/node", binSegments: ["bin"] });
    expect(versionRoots).toContainEqual({
      dir: "/opt/fnm/node-versions",
      binSegments: ["installation", "bin"],
    });
  });

  test("follows PNPM_HOME and XDG_DATA_HOME when they are set", () => {
    const withPnpmHome = claudeInstallLocations(env({ pnpmHome: "/opt/pnpm" }), posixJoin);
    expect(withPnpmHome.files).toContain("/opt/pnpm/claude");

    const withXdg = claudeInstallLocations(env({ xdgDataHome: "/opt/share" }), posixJoin);
    expect(withXdg.files).toContain("/opt/share/pnpm/claude");
    expect(withXdg.versionRoots).toContainEqual({
      dir: "/opt/share/fnm/node-versions",
      binSegments: ["installation", "bin"],
    });
  });

  test("names the Windows launchers, and skips the unix system directories", () => {
    const { files } = claudeInstallLocations(
      env({ platform: "win32", appData: "C:/Users/user/AppData/Roaming" }),
      posixJoin,
    );

    expect(files).toContain("C:/Users/user/AppData/Roaming/npm/claude.cmd");
    expect(files).toContain("C:/Users/user/AppData/Roaming/npm/claude.exe");
    expect(files).not.toContain("/usr/local/bin/claude");
  });

  test("offers nothing under a home it does not know", () => {
    const { files, versionRoots } = claudeInstallLocations(env({ home: undefined }), posixJoin);

    expect(files.every((file) => file.startsWith("/usr") || file.startsWith("/opt"))).toBe(true);
    expect(versionRoots).toStrictEqual([]);
  });
});

describe("orderNodeVersionDirectories", () => {
  test("puts the newest node version first", () => {
    expect(orderNodeVersionDirectories(["v20.19.5", "v24.18.1", "v22.22.0"])).toStrictEqual([
      "v24.18.1",
      "v22.22.0",
      "v20.19.5",
    ]);
  });

  test("compares each part as a number, not as text", () => {
    expect(orderNodeVersionDirectories(["v9.0.0", "v10.0.0"])).toStrictEqual(["v10.0.0", "v9.0.0"]);
    expect(orderNodeVersionDirectories(["v22.9.0", "v22.22.0"])).toStrictEqual([
      "v22.22.0",
      "v22.9.0",
    ]);
  });

  test("keeps names that are not versions, last and in order", () => {
    expect(orderNodeVersionDirectories(["lts", "v18.0.0", "alias"])).toStrictEqual([
      "v18.0.0",
      "lts",
      "alias",
    ]);
  });
});

describe("versionRootCandidates", () => {
  test("asks the newest node version before the ones it replaced", () => {
    expect(
      versionRootCandidates(
        { dir: "/home/user/.nvm/versions/node", binSegments: ["bin"] },
        ["v22.22.0", "v24.18.1"],
        "linux",
        posixJoin,
      ),
    ).toStrictEqual([
      "/home/user/.nvm/versions/node/v24.18.1/bin/claude",
      "/home/user/.nvm/versions/node/v22.22.0/bin/claude",
    ]);
  });

  test("reaches through the layout the root declares", () => {
    expect(
      versionRootCandidates(
        { dir: "/share/fnm/node-versions", binSegments: ["installation", "bin"] },
        ["v22.11.0"],
        "linux",
        posixJoin,
      ),
    ).toStrictEqual(["/share/fnm/node-versions/v22.11.0/installation/bin/claude"]);
  });
});
