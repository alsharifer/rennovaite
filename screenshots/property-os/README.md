# Property OS landing — screenshot manifest

Two captures are required to compare against the approved canvas. **They were
not captured in the build environment** — the headless preview pane cannot
composite frames (`computer{screenshot}` times out) and returns
`getBoundingClientRect() = 0` (no layout), so no real pixel capture or visual
diff is possible here. Composed/mock images are disallowed, so this file records
exactly what to shoot plus the DOM-level facts that were verified.

Capture with the flag on: add `PROPERTY_OS_LANDING=true` to `.env.local`,
restart `npm run dev`, then screenshot `/`.

| File | Viewport | State |
| --- | --- | --- |
| `desktop-1440x900.png` | 1440×900 | flag on, signed-out visitor — nav + hero + 4-card grid + footer |
| `mobile-390x844.png` | 390×844 | flag on, signed-out — wordmark + Sign-in button nav; 34px headline; short subline; live card (no meta line); 3 collapsed roadmap tiles (band + short description) |

## Verified in-build (DOM / behaviour, not pixels)

- **Flag OFF:** `/` and `/rennovaite` both render the RennovAIte homepage (`From your floorplan…`); no Property OS content. `next build` shows `/` unchanged in content.
- **Flag ON:** `/` renders Property OS. Copy present verbatim: `PROPERTY OS`, eyebrow `ONE PLATFORM FOR THE LIFE OF A PROPERTY`, h1 `Design it. Price it. Get it built.`, `LIVE NOW`, `Enter RennovAIte`, `Reconstruction`, `Ground-up`, `Facilities Management`, footer `Every number traces to a real element, rule, or transaction — calibrated on signed Dubai contracts.`
- **Links:** only `/auth` (Sign in ×2) and `/rennovaite` (Open RennovAIte + Enter RennovAIte). No roadmap product links → **tiles inert** (no `<a>`), no dead links / 404s.
- **Semantics:** `<header>/<main>/<footer>`; exactly one `<h1>` (headline); pillar titles are `<h2>` (RennovAIte, Reconstruction, Ground-up, Facilities Management); roadmap `<li>`s carry `aria-label="… — on the roadmap, not yet available"`.
- **Keyboard order:** Sign in → Open RennovAIte → Enter RennovAIte (mobile Sign-in button is `display:none` on desktop and skipped).
- **Title:** `Property OS — by RennovAIte`.
- **Auth-aware:** signed-out visitor gets the page; signed-in users are redirected to `/project` (code path; a live session could not be simulated here).

## Token ↔ design-hex divergences (token wins, per the brief)

Standard roles use Atelier tokens; where the token resolves to a different hex
than the design's resolved value, **the token was kept** and the delta is logged
here:

| Role | Design hex | Token used | Token hex |
| --- | --- | --- | --- |
| Page canvas | `#FAF6EF` | `bg-canvas` | `#F7F3EC` |
| Ink text | `#0B1220` | `text-ink-900` | `#0F1B2D` |
| Roadmap card bg | `#F4F1EA` | `bg-bone` | `#EDE6D8` |
| Hairline borders | `#E7E0D2` | `border-ink-100` | `#e2e8f0` |
| Muted body/notes/footer | `#5c5648` / `#7E7A6F` / `#9a938a` | `text-on-surface-variant` | `#4f4539` |
| P3 band | `#0B1220` | `bg-ink-900` | `#0F1B2D` |

Bespoke decorative values with **no semantic token** use the design hex directly
(flagged as intentional): live band `#C9964B`, P2A band `#D9BE8C`, P2B band
`#131F33`, green "live" dot `#3FA97A`, and the on-band label colours
(`#4a3d22` / `#F4F1EA` / `#8fa0bd` / `#7E7A6F`). The card shadow uses
`shadow-level-1`→`shadow-level-2` (sanctioned tokens) in place of the design's
literal `0 8px 28px rgba(11,18,32,0.07)`.
