// T5 — the one transport: HTTP to the app's own routes, carrying the job id the
// document routes require. The CLI points it at the dev server; the in-app job at
// its own origin. Same requests, same routes, same bytes.

import { PACK_JOB_HEADER } from "./guard-header";
import type { PackTransport } from "./types";

export function httpTransport(base: string, jobId: string, fetchImpl: typeof fetch = fetch): PackTransport {
  const headers = { [PACK_JOB_HEADER]: jobId };
  const json = async <T>(res: Response) => ({ status: res.status, body: (await res.json().catch(() => ({}))) as T });
  return {
    get: async <T>(path: string) => json<T>(await fetchImpl(base + path, { headers })),
    post: async (path, body) =>
      json<Record<string, unknown>>(await fetchImpl(base + path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    bytes: async (path) => {
      const res = await fetchImpl(base + path, { headers });
      return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    text: async (path) => {
      const res = await fetchImpl(base + path, { headers });
      return { status: res.status, text: await res.text() };
    },
  };
}
