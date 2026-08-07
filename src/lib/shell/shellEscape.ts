/**
 * Shell-escape a string using double quotes.
 * Escapes backslashes, double quotes, dollar signs, and backticks.
 */
export const shellEscape = (value: string): string => {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  return `"${escaped}"`;
};
