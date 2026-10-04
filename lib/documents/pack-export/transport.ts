// T5 — the one transport: HTTP to the app's own routes, carrying the job id the
// document routes require. The CLI points it at the dev server; the in-app job at
// its own origin. Same requests, same routes, same bytes.
//
// H1: every route needs a signed-in caller, so the transport also carries the
// credential of whoever started the job — the member's session for the in-app
// action (lib/auth/caller.ts → forwardableAuthorization), the dev account's for
// the CLI (scripts/lib/dev-auth.mjs). The job id authorises the documents; the
// session authenticates the request. Neither stands in for the other.

import { PACK_JOB_HEADER } from "./guard-header";
import type { PackTransport } from "./types";

export interface HttpTransportOptions {
  /**
   * `Bearer <jwt>` of the account the job acts for — or a getter, for a CLI
   * run long enough to need a fresh one (scripts/lib/dev-auth.mjs → devFetch).
   */
  authorization: string | (() => string | Promise<string>);
  fetchImpl?: typeof fetch;
}

export function httpTransport(base: string, jobId: string, { authorization, fetchImpl = fetch }: HttpTransportOptions): PackTransport {
  const headers = async (): Promise<Record<string, string>> => ({
    [PACK_JOB_HEADER]: jobId,
    authorization: typeof authorization === "string" ? authorization : await authorization(),
  });
  const json = async <T>(res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as T });
  return {
    get: async <T>(path: string) => json<T>(await fetchImpl(base + path, { headers: await headers() })),
    post: async (path, body) =>
      json<Record<string, unknown>>(await fetchImpl(base + path, { method: "POST", headers: { ...(await headers()), "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    bytes: async (path) => {
      const res = await fetchImpl(base + path, { headers: await headers() });
      return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    text: async (path) => {
      const res = await fetchImpl(base + path, { headers: await headers() });
      return { status: res.status, text: await res.text() };
    },
  };
}
