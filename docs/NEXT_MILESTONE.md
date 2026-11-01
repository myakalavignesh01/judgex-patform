# Next milestone: authenticated event foundation

Historical milestone-01 plan. Current implementation status is in `REQUIREMENTS_STATUS.md`; deployment is in `PRODUCTION_SETUP.md`.

The PRD recommends dependable human-scored completion before AI. This first slice validates that workflow without claiming backend security. The next milestone must replace the local store with an authenticated API; do not bolt real participant data onto localStorage.

## Architecture boundary

Keep the current React/TypeScript UI. Add Supabase Auth and PostgreSQL with migrations, RLS, private storage, and a bounded TypeScript API. Reuse and validate the deterministic domain rules on the server. Treat every browser value, URL, file, transcript, and repository as untrusted data. Never expose service-role credentials to the frontend.

## Ordered implementation

1. Select pilot region, identity settings, event limits, retention and recording alternatives. Provision separate development and staging Supabase projects.
2. Create organizations, organization memberships, events, event memberships, teams and authenticated invitation acceptance. A role selector must never grant permissions.
3. Add versioned projects, locked submission snapshots and rubric versions, approved scorecards and append-only score changes. Server transitions must be transactional and idempotent.
4. Add server authorization and RLS for every record and private object path. Participant APIs must never return unreleased scores or another team's data.
5. Add private upload intents, MIME and size checks, malware-scanning state, checksum metadata, and authorized expiring downloads.
6. Release results atomically with outbox jobs. Delivery workers can send approved results but cannot approve or mutate scores. Add retries, backoff, idempotency and failure states.
7. Add AI only behind a provider adapter after the complete human-scored path passes. Require structured criterion output, version metadata, evidence citations, uncertainty, and an insufficient-evidence state.

## Acceptance gates

- Verified organizers and participants complete one event using separate accounts.
- Cross-tenant, cross-team, direct-object and unreleased-score access attempts fail at API, database and storage layers.
- Locked submissions and frozen rubrics cannot be modified, including direct API attempts.
- Approvals preserve prior scores, actors, reasons, rubric version and submission version.
- Release is idempotent; duplicate workers do not send duplicate logical notifications.
- Provider outage leaves human scoring and result access operational.
- Restore and rollback are demonstrated before inviting real pilot participants.

## Product decisions used by this demo

- Human-only scoring; no simulated AI-generated scores.
- Six synthetic teams, four rubric criteria, 0–10 criterion scale, 100-point weighted total.
- India event timezone (Asia/Kolkata) and non-recorded presentation slots are editable implementation assumptions for the first pilot, not inferred production requirements.
- Equal totals remain ties; alphabetical display does not break a tie.
- Released results are read-only. Appeals and revision releases require backend versioning in a later slice.

The hosted demo's private audience is independent of the app's future tenant authorization. Neither replaces the other.
