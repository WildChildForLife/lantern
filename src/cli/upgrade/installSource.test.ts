import { describe, expect, it } from "vitest";
import { classifyInstallSource, type InstallProbe } from "./installSource.ts";

const base: InstallProbe = {
  scriptPath: "/usr/local/lib/node_modules/lantern-viewer/dist/main.js",
  packageRoot: "/usr/local/lib/node_modules/lantern-viewer",
  platform: "linux",
  env: {},
  containerMarker: false,
  gitMarker: false,
  systemPackageManager: "unknown",
};

const probe = (overrides: Partial<InstallProbe>): InstallProbe => ({ ...base, ...overrides });

describe("classifyInstallSource", () => {
  it("reads a global npm install, and where it lives", () => {
    expect(classifyInstallSource(base)).toEqual({
      kind: "npm-global",
      manager: "npm",
      root: "/usr/local/lib/node_modules",
    });
  });

  it("reads a version-manager install as npm", () => {
    const source = classifyInstallSource(
      probe({
        scriptPath:
          "/home/u/.nvm/versions/node/v24.4.0/lib/node_modules/lantern-viewer/dist/main.js",
        packageRoot: "/home/u/.nvm/versions/node/v24.4.0/lib/node_modules/lantern-viewer",
      }),
    );

    expect(source).toEqual({
      kind: "npm-global",
      manager: "npm",
      root: "/home/u/.nvm/versions/node/v24.4.0/lib/node_modules",
    });
  });

  it("tells the package managers apart by where they keep their global tree", () => {
    const managers = [
      {
        path: "/home/u/.local/share/pnpm/global/5/node_modules/lantern-viewer/dist/main.js",
        manager: "pnpm",
      },
      {
        path: "/home/u/.config/yarn/global/node_modules/lantern-viewer/dist/main.js",
        manager: "yarn",
      },
      {
        path: "/home/u/.bun/install/global/node_modules/lantern-viewer/dist/main.js",
        manager: "bun",
      },
    ];

    for (const { path, manager } of managers) {
      const source = classifyInstallSource(probe({ scriptPath: path }));

      expect(source.kind).toBe("npm-global");
      expect(source.kind === "npm-global" ? source.manager : null).toBe(manager);
    }
  });

  /** Windows writes the same tree with the other separator, under AppData. */
  it("reads a global npm install on Windows", () => {
    const source = classifyInstallSource(
      probe({
        scriptPath:
          "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\lantern-viewer\\dist\\main.js",
        packageRoot: "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\lantern-viewer",
        platform: "win32",
      }),
    );

    expect(source).toEqual({
      kind: "npm-global",
      manager: "npm",
      root: "C:/Users/u/AppData/Roaming/npm/node_modules",
    });
  });

  it("reads a Homebrew install, on either prefix", () => {
    const prefixes = ["/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"];

    for (const prefix of prefixes) {
      const source = classifyInstallSource(
        probe({
          scriptPath: `${prefix}/Cellar/lantern-viewer/0.3.0/libexec/lib/node_modules/lantern-viewer/dist/main.js`,
        }),
      );

      expect(source).toEqual({ kind: "homebrew", prefix });
    }
  });

  /**
   * The formula's tree *is* an npm install, so the Cellar has to be recognised
   * first — otherwise a `brew` user is told to run `npm install -g`, which
   * would leave two Lanterns on PATH.
   */
  it("calls a Cellar under /usr/local Homebrew, not npm", () => {
    const source = classifyInstallSource(
      probe({
        scriptPath:
          "/usr/local/Cellar/lantern-viewer/0.3.0/libexec/lib/node_modules/lantern-viewer/dist/main.js",
      }),
    );

    expect(source.kind).toBe("homebrew");
  });

  it("reads the retired deb and rpm layout, and which tool would remove it", () => {
    expect(
      classifyInstallSource(
        probe({
          scriptPath: "/usr/lib/lantern/dist/main.js",
          packageRoot: "/usr/lib/lantern",
          systemPackageManager: "apt",
        }),
      ),
    ).toEqual({ kind: "system-package", manager: "apt" });
  });

  it("reads a container by its marker file", () => {
    expect(
      classifyInstallSource(
        probe({ scriptPath: "/app/dist/main.js", packageRoot: "/app", containerMarker: true }),
      ),
    ).toEqual({ kind: "docker" });
  });

  /** Podman and containerd write no /.dockerenv; Lantern's own image is still /app. */
  it("reads Lantern's own image without a marker file", () => {
    expect(
      classifyInstallSource(
        probe({
          scriptPath: "/app/dist/main.js",
          packageRoot: "/app",
          env: { LANTERN_ENV: "production" },
        }),
      ),
    ).toEqual({ kind: "docker" });
  });

  /**
   * A devcontainer, a CI image, somebody's own Dockerfile: a global install
   * inside one is still a global install, and its owner upgrades it the way
   * anybody else would. Only Lantern's own image is beyond upgrading.
   */
  it("does not mistake every container for Lantern's image", () => {
    const npmInAContainer = classifyInstallSource(probe({ containerMarker: true }));
    const debInAContainer = classifyInstallSource(
      probe({
        scriptPath: "/usr/lib/lantern/dist/main.js",
        packageRoot: "/usr/lib/lantern",
        containerMarker: true,
        systemPackageManager: "apt",
      }),
    );

    expect(npmInAContainer.kind).toBe("npm-global");
    expect(debInAContainer.kind).toBe("system-package");
  });

  it("reads a one-off npx run", () => {
    const caches = [
      "/home/u/.npm/_npx/1a2b3c/node_modules/lantern-viewer/dist/main.js",
      "/home/u/.local/share/pnpm/dlx-1a2b3c/node_modules/lantern-viewer/dist/main.js",
      "/home/u/.bun/install/cache/lantern-viewer@0.3.0/dist/main.js",
    ];

    for (const path of caches) {
      expect(classifyInstallSource(probe({ scriptPath: path })).kind).toBe("npx-cache");
    }
  });

  it("reads a git checkout, built or run from source", () => {
    const built = classifyInstallSource(
      probe({
        scriptPath: "/home/u/code/lantern/dist/main.js",
        packageRoot: "/home/u/code/lantern",
        gitMarker: true,
      }),
    );
    const source = classifyInstallSource(
      probe({
        scriptPath: "/home/u/code/lantern/src/server/main.ts",
        packageRoot: "/home/u/code/lantern",
        gitMarker: true,
      }),
    );

    expect(built).toEqual({ kind: "git-checkout", root: "/home/u/code/lantern" });
    expect(source).toEqual({ kind: "git-checkout", root: "/home/u/code/lantern" });
  });

  /**
   * A checkout can live anywhere, including inside a prefix that would
   * otherwise read as an install.
   */
  it("prefers the checkout to the path it happens to sit in", () => {
    const source = classifyInstallSource(
      probe({
        scriptPath: "/usr/local/lib/node_modules/lantern-viewer/dist/main.js",
        packageRoot: "/usr/local/lib/node_modules/lantern-viewer",
        gitMarker: true,
      }),
    );

    expect(source.kind).toBe("git-checkout");
  });

  it("keeps the path when it cannot tell, so the message can show it", () => {
    expect(classifyInstallSource(probe({ scriptPath: "/opt/weird/lantern/main.js" }))).toEqual({
      kind: "unknown",
      path: "/opt/weird/lantern/main.js",
    });
  });
});
