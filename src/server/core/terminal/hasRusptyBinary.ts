/**
 * Whether @replit/ruspty ships a prebuilt native module for a platform.
 *
 * It publishes three: darwin x64, darwin arm64 and linux x64 (gnu). Everything
 * else has nothing to load — Windows, and also the linux/arm64 image this
 * project publishes for the Raspberry Pi and Apple Silicon crowd, for which no
 * `@replit/ruspty-linux-arm64-gnu` package exists on npm at any version.
 *
 * Callers use this to disable terminal support up front rather than letting the
 * dynamic import fail with a MODULE_NOT_FOUND stack on every startup.
 */
export const hasRusptyBinary = (platform: string, arch: string): boolean => {
  if (platform === "darwin") {
    return arch === "x64" || arch === "arm64";
  }
  if (platform === "linux") {
    return arch === "x64";
  }
  return false;
};
