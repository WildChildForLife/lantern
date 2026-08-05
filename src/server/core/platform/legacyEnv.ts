/**
 * Environment variables named after the project's previous identity, mapped to
 * the name that replaced them. They are still honoured — with a warning at
 * startup — so an existing deployment keeps working across the rename.
 */
export const LEGACY_ENV_ALIASES: Readonly<Record<string, string>> = {
  CCV_ENV: "LANTERN_ENV",
  CCV_PASSWORD: "LANTERN_PASSWORD",
  CCV_VERBOSE: "LANTERN_VERBOSE",
  CCV_API_ONLY: "LANTERN_API_ONLY",
  CCV_CC_EXECUTABLE_PATH: "LANTERN_CLAUDE_EXECUTABLE",
  CCV_GLOBAL_CLAUDE_DIR: "LANTERN_CLAUDE_DIR",
  CCV_TERMINAL_SHELL: "LANTERN_TERMINAL_SHELL",
  CCV_TERMINAL_UNRESTRICTED: "LANTERN_TERMINAL_UNRESTRICTED",
  CCV_TERMINAL_DISABLED: "LANTERN_TERMINAL_DISABLED",
};

/**
 * Returns `env` with every legacy variable copied onto its current name, unless
 * the current name is already set. The input is never mutated.
 */
export const withLegacyEnvAliases = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> => {
  const resolved: Record<string, string | undefined> = { ...env };

  for (const [legacyKey, currentKey] of Object.entries(LEGACY_ENV_ALIASES)) {
    const legacyValue = env[legacyKey];
    if (legacyValue !== undefined && resolved[currentKey] === undefined) {
      resolved[currentKey] = legacyValue;
    }
  }

  return resolved;
};
