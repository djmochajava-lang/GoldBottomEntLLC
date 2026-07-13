# story-bio-b-collect — PUBLIC-SITE UI report (Flow A + Flow B)

**Repo:** public `GoldBottomEntLLC` · **Branch:** `story-bio-b-public-ui` (NOT merged to master).
**Contract followed:** `GBE-HomeOffice/BIO_B_SERVER_REPORT.md` §7 (client-facing surface). **Design/ACs:** `memory/DESIGN_bio-b-experience.md`.
**Decision basis:** D-49 (submission of source material, NOT self-publish).

---

## 1. Files changed

| File | Change |
|---|---|
| `dashboard/my-portal.html` | **Flow A** — added a new "My Bio" section (card under Pending) + `.mybio-*` CSS + a self-contained `<script>` IIFE that reads/writes the member's own Supabase `bio_submissions` row and stages photos to Storage, via the **existing** authenticated PKCE client `Auth._sb`. The pre-existing portal IIFE (Firestore-shaped `Auth._db`) is untouched. |
| `dashboard/band-roster.html` | **Flow B** — added `rosterId` (SoR roster id) to each roster object, an "Edit bio on behalf" button per member card (gated by `Auth.isLocalDashboard()`), `.brb-*` CSS, and the on-behalf editor (fields + counters + **rendered approval preview** + draft-only save via `Utils.apiFetch` + explicit link-to-account affordance). |

No new JS/CSS asset files were added, so no `index.html` `?v=N` bumps were needed. The pre-commit SW-hash hook regenerates `sw.js`/`js/build.js` for the changed HTML and stages them into the feature commit (no `--no-verify`).

**Client reuse (per RULES):** Flow A uses `Auth._sb` — the member's existing PKCE supabase-js client created in `js/auth.js:_initSupabase()` (`this._sb`). No second client is created and no re-auth happens. The member's `auth.uid()` is read live via `Auth._sb.auth.getSession()` (falls back to `Auth._user.uid`).

---

## 2. Flow A → Acceptance-Criteria map

**ATTRACTION**
- **AC-A1** — First visit is one inviting card ("Share your bio & photos so we can feature you") with a single **"Add my bio"** primary button; no fields exposed until tapped. ✔
- **AC-A2** — Rendered bio-card preview available before submit (consent step is reached from the editor) and after (submitted state → **"Preview what you shared"** renders the card, incl. live headshot/promo thumbnails). ✔
- **AC-A3** — Uses the portal's tokens/cards (`--space-*`, `--color-gold`, `--radius-*`, `.portal-*` visual language, `.mybio-card` mirrors `.portal-invite-card`). Reads native (see screenshots). ✔

**EASE**
- **AC-E1** — Fields in plain-language order (stage_name → role_line → credit_line → short_bio → long_bio) each with a helper example + **live char counter**; caps shown (`40/30/80/280/1200`), **never silent-truncated** — over-cap flags the input+counter red and blocks "Review", the full text is preserved. ✔ (verified: 68-char role_line kept at length 68, Review disabled.)
- **AC-E2** — Working draft autosaves to `localStorage['gbe-bio-draft-<uid>']` on every input (debounced) incl. staged photo keys; a returning member resumes in the edit state; a persistent **"Draft — only you & your manager can see this"** chip is shown. ✔
- **AC-E3** — Consent is its **own distinct step AFTER review** (never an inline field): plain-language summary of why/how GBE uses the material, **full terms one tap away** ("Read the full terms"), sworn attestations, and the button reads **"I understand — share with my manager"** (never "publish"). ✔
- **AC-E4** — Withdraw is one tap ("Take back my submission") with a plain-language confirm; it's an **UPDATE** to `status:'withdrawn'` (NOT delete), landing a "private draft again" state with "Share again". ✔
- **AC-E5** — All targets ≥44px (buttons `min-height:48px`, inputs 44px+, `font-size:16px` to avoid iOS zoom); completes one-handed at **390×844** with no horizontal scroll (tested at 390px). ✔

**CONVENIENCE**
- **AC-C1** — Minimum path to *shared*: short_bio + one consent tap. Photos, long bio, and credits never block. (Publication itself is the later bio-c BM/admin decision — D-49.) ✔
- **AC-C2** — Headshot AND promo uploads never block text entry; each previews inline immediately via `URL.createObjectURL(file)` (no reload) while the raw file uploads to staging in the background. ✔
- **AC-C4** — Promo photo is a distinct slot from the headshot, visually differentiated by purpose (round portrait frame vs wide landscape frame + "landscape works best" hint); neither blocks the other or blocks submit. ✔
- **AC-C3** — *(BM-authored-draft path)* Flagged — see §6. The member's own-submission review→edit→re-share works fully; reviewing a **BM**-authored draft needs a SoR→member read projection that does not exist yet.

**GUARDRAILS**
- **AC-G1** — No draft is ever written to a public read surface by this UI. Member submissions land in `bio_submissions` (RLS own-row) and the SoR draft via the reconciler; the public band page is not in this write path. ✔ (structural)
- **AC-G2** — Enforced on the **BM** screen (Flow B) — see §4. Flow A's end state is "shared", never "live". ✔
- **AC-G3** — No consent → no publish is server-enforced (fail-closed); the UI surfaces consent as a distinct required step that is reachable/holdable, never a dead end. Submitting without the sworn attestations is impossible (button disabled). ✔

---

## 3. Exact Supabase calls written (confirm against §7)

**Submit / edit — §7a upsert (captured live in the dev harness, verbatim):**
```js
await Auth._sb.from('bio_submissions').upsert({
  payload: {
    stage_name, role_line, credit_line, short_bio, long_bio,   // strings, capped 40/30/80/280/1200
    images: {
      headshot_staging_key: 'bio-staging/<auth.uid()>/headshot-<uuid>.png' | null,
      promo_staging_key:    'bio-staging/<auth.uid()>/promo-<uuid>.<ext>'  | null
    }
  },
  consent: {
    version: 'bio-consent-v1-2026-07',            // mirrors server bio-consent-disclosure.js
    agreedAt: new Date().toISOString(),
    legalName: '<member legal name>',
    ageAttestation18Plus: true,
    accuracyAttestation: true,
    photoRightsWarranty: <true iff a photo is attached>,
    elementsAcknowledged: ['store','use_adapt','not_self_publish','publish_is_gbe','withdrawable','accuracy','age_18_plus','photo_rights','credits_verified']
  },
  status: 'submitted'
}, { onConflict: 'user_id' });                    // user_id OMITTED — RLS sets it
```

**Photo staging upload — §7b (captured: `bio-staging/test-uid-123/headshot-<uuid>.png`):**
```js
const key = `bio-staging/${uid}/${slot}-${uuid()}.${ext}`;   // slot ∈ {headshot,promo}
await Auth._sb.storage.from('band-media').upload(key, file, { contentType: file.type, upsert: false });
// then payload.images.<slot>_staging_key = key; preview client-side from the local File.
```

**Read own submission (load/pre-fill) — §7a:**
```js
await Auth._sb.from('bio_submissions').select('*').maybeSingle();   // RLS returns only caller's row
```

**Withdraw — §7a (UPDATE not DELETE):**
```js
await Auth._sb.from('bio_submissions').update({ status: 'withdrawn' }).eq('id', existing.id);
```

Consent copy (`version`, `text`, `elements`) is **mirrored** from `server/src/config/bio-consent-disclosure.js` (§7c) with a source comment; it is DRAFT pending Legal — if the server bumps `version`, update the mirror.

---

## 4. Flow B — draft-only + explicit link enforcement

- **Surface & gating:** the "Edit bio on behalf" button renders only when `Auth.isLocalDashboard()` is true (Flow B rides `Utils.apiFetch`, which rejects remote by design). It passes only the `rosterId` (safe charset `[A-Za-z0-9_-]`) to the inline handler; the name is looked up in-handler to avoid quote-injection from member names.
- **`rosterId` correctness:** the roster cache `doc.id` equals the SoR `roster.id` (publish-engine sets `record.id = row.id`), which is exactly the `:rosterId` the bio route validates (`ROSTER_ID_RE`). `firebaseUid` (the linked account) is kept as a **separate** field.
- **Editor:** GET `/api/v1/bio/:rosterId` pre-fills the same 5 fields with counters; a **"Preview"** toggle renders the bio card as it will look (AC-A2, rendered — not raw fields).
- **Draft-only (AC-G2):** the only write is **"Save as draft"** → `PUT /api/v1/bio/:rosterId` with a body of exactly `{stage_name, role_line, credit_line, short_bio, long_bio}` (matches the server `contentSchema`, `unknown:false`). There is **no** approve/publish control anywhere on the screen. Success shows: *"Saved as draft. [Member] must confirm before it's used publicly."* A standing notice states the same up top.
- **Link-profile-to-account:** shown **only** for unlinked rows (`hasLinkedAccount:false`) as a visually separate box that states linking is *"a deliberate, separate step — never done automatically by name match."* The affordance is explicit; it performs **no** auto-link (there is no bio-b link endpoint — auth_uid binding is owned by the identity/roster-create service). Clicking it reveals where linking is done deliberately. No name-match auto-link path exists anywhere in this code.

**PUT captured live:** `PUT /api/v1/bio/gbe_test_1` body `{stage_name:"New Stage Name", role_line:"", credit_line:"", short_bio:"Updated short bio by BM.", long_bio:""}`.

---

## 5. What was tested on dev (port 9111) with Playwright

Because a live member **PKCE session** is not available on dev, each flow was exercised against its **real fragment file** loaded into a mock harness (mock `Auth._sb` / `Utils.apiFetch` / `Modal` / `Toast`) served same-origin from the dev server, so the fragment code is the code under test (no copy/drift). Harness files were deleted after testing.

**Flow A (my-portal.html):**
- Empty → edit → counters live (short `68/280`, role `19/30`); **over-cap** role_line (68 chars) flags `over` on input+counter, value NOT truncated (len 68), and blocks "Review". ✔
- Headshot pick → upload call `band-media` / `bio-staging/test-uid-123/headshot-<uuid>.png`, `upsert:false`, `contentType:image/png`. ✔
- Review → consent (distinct step): terms toggle reveals full disclosure; submit disabled until legalName + age + accuracy + (photo-rights when a photo is attached). ✔
- Submit → upsert payload **matches §7a verbatim** (see §3); `onConflict:'user_id'`, `user_id` omitted. Final state = "shared with your manager" (never "live"). ✔
- Preview renders the card; Withdraw → `update({status:'withdrawn'}).eq('id',…)` (not delete) → "taken back" state with "Share again"; reshare pre-fills from the prior submission. ✔
- **Console: 0 code errors** (only a benign `favicon.ico` 404).

**Flow B (band-roster.html):**
- Roster card shows "Edit bio on behalf" (isLocal gate) → GET `/api/v1/bio/gbe_test_1`; editor opens titled "Edit bio — Test Member", fields pre-fill from `bioProfile`. ✔
- Preview renders the approval card; over-cap stage_name (66 chars) blocks Save without truncating. ✔
- Save → PUT with exactly the 5 content fields; "Saved as draft … must confirm before it's used publicly"; **no publish/approve control present** (regex check for Publish/Approve = none). ✔
- Unlinked-row link affordance present and explains "never automatically"; performs no auto-link. ✔

Screenshots captured during the run (dev scratchpad): `bio-a-empty.png`, `bio-a-consent.png`, `bio-a-submitted.png`, `bio-b-editor.png`.

**Deferred to QA (needs a real logged-in member on the deployed public site):**
- End-to-end RLS behavior (member INSERT own row / deny foreign / withdraw) via a real PKCE session — the harness proves the **call shape + DOM + state machine**, not the live RLS round-trip. Server report §8 lists this same item.
- Real Supabase Storage staging upload under a member session (bucket policy allows only `bio-staging/<auth.uid()>/…`).
- iPhone Safari device pass (deferred per D-40; desktop 390px is the bar met here).

---

## 6. "Member reviews BM-authored draft" (Flow A step 5 / AC-C3) — decision: FLAGGED

Implemented: the member's **own** submission lifecycle in full (empty → edit → consent → submitted → preview/edit/withdraw → re-share).

Not wired: a member reviewing a bio a **BM drafted for them**. The BM draft lives in the SoR `roster.data.bioProfile` (written via the LAN route); the remote member can only read `bio_submissions` (their own submissions, RLS own-row). There is **no Supabase-readable projection** of the SoR `bioProfile` draft for the member (not in the server report §7/§8). Per the build instructions this is flagged as a **follow-on requiring a SoR→member read projection** (e.g., publish the BM draft into the member's `bio_submissions` row, or a member-readable `bio_drafts` view) — it does not block this build. AC-C3's ≤2-tap review→agree-publish depends on that projection.

---

## 7. Open items / handoff

1. **Live-session E2E** (RLS + Storage) with a real member PKCE login on the deployed site — QA item (§5).
2. **BM-draft → member review projection** — follow-on (§6) to complete Flow A step 5 / AC-C3.
3. **Consent copy is DRAFT pending Legal** — the client mirror of `bio-consent-disclosure.js` must be updated (and `version` re-synced) if Legal changes the wording.
4. **Reconciler is DORMANT on prod** (`BIO_SUBMISSIONS_SYNC_ENABLED` unset) — until an owner/ops enables it, submitted rows land in Supabase but are not pulled into the SoR (server report §8). The UI is correct regardless.
5. Branch `story-bio-b-public-ui` is left for review; **not** merged to master / not deployed.
