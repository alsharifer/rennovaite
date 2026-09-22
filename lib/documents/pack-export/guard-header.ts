// The header a pack export job sends; split out so the CLI transport does not
// import next/server through guard.ts.
export const PACK_JOB_HEADER = "x-pack-export-job";
