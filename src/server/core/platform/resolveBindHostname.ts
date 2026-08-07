/**
 * The address the server should bind to.
 *
 * Two things this deliberately does not do.
 *
 * It does not read the bare `HOSTNAME` variable. Docker and Kubernetes both set
 * that to the container's id, and binding to it leaves the server listening on
 * an address nothing can reach — the container answered on
 * `http://<container-id>:3400` and every request to localhost was refused. The
 * variable belongs to the environment, not to this application, so the
 * application uses its own `LANTERN_HOSTNAME`.
 *
 * It also does not pass `localhost` through to `listen`. Node resolves it and
 * takes the first answer, which on a dual-stack machine is `::1`, so the server
 * ends up reachable over IPv6 loopback while `127.0.0.1` is refused. Resolving
 * it here to the IPv4 loopback makes the common case work; anyone who wants the
 * IPv6 one asks for `::1`, and `::` binds both.
 */
export const LOOPBACK_IPV4 = "127.0.0.1";

export const resolveBindHostname = (
  cliHostname: string | undefined,
  lanternHostname: string | undefined,
): string => {
  const chosen = firstNonEmpty(cliHostname, lanternHostname) ?? "localhost";
  return chosen === "localhost" ? LOOPBACK_IPV4 : chosen;
};

const firstNonEmpty = (...values: ReadonlyArray<string | undefined>): string | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
};
