# lib/boq

Owned by **Pilot Seven — Prompt P5 (BoQ rate book / deterministic engine)**.

**Already populated** (predates the pre-flight): `engine.ts`, `takeoff.ts`,
`rules.ts`, `rates.ts`, `schema.ts`, `fixtures/`. This is the default,
LLM-free pricing path (`app/api/generate-boq` uses it unless `BOQ_ENGINE="llm"`).
P5 extends this module — it is NOT an empty scaffold. See
`PILOT_SEVEN_PREFLIGHT.md`.
