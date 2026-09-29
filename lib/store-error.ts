// A store function's refusal: an HTTP status, a stable code and a message.
// Its own module (H5) so a light module can throw or catch it without pulling
// in the firm store's vocabulary and ground-truth imports; lib/firms/store.ts
// re-exports it, so every existing `instanceof StoreError` is the same class.
export class StoreError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}
