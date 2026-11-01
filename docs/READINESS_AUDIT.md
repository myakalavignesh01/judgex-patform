# JudgeX PRD and architecture audit

Reviewed 1 November 2026 against JudgeX Production PRD v1.0 (31 October 2026), the supplied architecture image, source, database migrations and local checks.

## Verdict

**Not ready for a general production launch.** There is a substantial implementation, but a successful build is not proof that the complete hosted product works. The production frontend and Supabase are connected. A real organizer has created a private pilot event, persisted a problem statement and tested rubric validation. A distinct participant journey, real AI/media/scanning/email, and production recovery have not been verified. The processing API/worker host is not connected.

## Changes made during this audit

- Event settings now preserve omitted fields and display existing deadlines. Added registration opening/closing, capacity, team size, eligibility text, format, start time and editable name/description. Registration and team creation enforce the window in PostgreSQL. Eligibility text is disclosure, not automated verification.
- Added project problem, solution, stack, impact, demo URL and contribution/AI-use/limitation declarations. These values are saved, included in the immutable snapshot and indexed as evidence at lock.
- Approval now links the assessment run and records the same provenance in score history. Differences from available AI criterion suggestions require an explanation; human-only scoring stays available.
- Added organizer/participant readiness lists, event-scoped bounded query batches, paginated reads and periodic refresh outside editing screens. These are not realtime subscriptions.
- Fixed concurrent token-refresh requests and added mobile-accessible sign-out. Added pending-file validation retry, invitation decline and explicit closed-event guards.
- Added organizer-authorized, audited CSV export of human-approved results with decision/version/time metadata, unreleased-result labels and spreadsheet-formula escaping.
- Added PostgreSQL-backed authenticated API budgets, a bounded per-process pre-auth limiter, privacy-conscious request metadata logs and frontend CSP. Infrastructure DDoS protection still depends on the host.
- Added conflict-checked presentation slots, queue progression, opt-in schedule/reminder outbox jobs with revision cancellation, and project-defence evidence snapshots. Added rubric guidance and deterministic tie-break priorities across organizer ordering, public totals and exports.
- Replaced the setup health message that discarded its own output with visible configuration states. Presence of settings does not establish that provider accounts work.

The user-supplied JUDGEX LEO reference was inspected on 1 November: dashboard, presentation controls and successful-backend-only score state. The five-specialist flow from the supplied diagram is now implemented in the JudgeX worker and organizer review UI. Provider execution remains unverified. Released corrections now append versions and queue notices while preserving original scorecards.

## Remaining work by PRD area

| Area | Source status | What is still needed |
| --- | --- | --- |
| Public site | Auth and operator setup; earlier labelled demo | Full homepage, role entry paths, sample report, FAQ/support, pricing packaging and reviewed public policies |
| Identity | Email verification, recovery, sessions, event-scoped roles | Organizer MFA/step-up, delegated permissions, production SMTP and separate-account hosted tests |
| Organization/events | Event operations and rules | Organization reuse/admin UX, discovery/visibility controls, eligibility verification and registration-boundary browser tests |
| Teams | Create, authenticated email-bound accept/decline, revoke, directory | Resend/rotation, remove/leave/transfer-captain policy and audited member-management UI |
| Project workspace | Detailed autosave and immutable lock | Policy-controlled post-lock revisions and clearer field/readiness validation |
| Uploads | Private PDF/images/media, limits, signatures, scanner adapter, retry validation | Connected scanner; resumable upload/progress; PPT/PPTX parser; safe archive extraction/link policy; real failure/retry tests |
| Presentation operations | Conflict-checked versioned slots, room/queue progression, support check, opt-in schedule/reminder jobs, project-defence questions with immutable answers, consent, capture, timer, local recovery | Real device/recording tests, room-provider integration and richer event alternatives |
| Live presentation | Local camera/screen recording | Remote participant/organizer conferencing, reconnect/network recovery and live captions. Local capture is not a live meeting |
| Vision/transcription | Gemini OCR/chart/diagram/media extraction and checkpointed windows | Provider credentials/host, real files and languages, source-quality checks, consent/device tests and cleanup verification |
| Repository ingestion | Public pinned GitHub snapshots, read-only, no execution | Private-repository GitHub App authorization, revocation and installation UX |
| RAG | Chunking, pgvector, hybrid retrieval, authorization | Embedding configuration, golden-set recall/citation precision, model changes and reindexing. Keyword fallback is not semantic RAG |
| Agents | Five specialist reviewers with criterion assignments, median combination, consistency/feedback calls and validated checkpoints | Live provider tests, calibration, adversarial/prompt-injection fixtures, semantic citation relevance checks, quality/cost evaluation |
| Rubrics | Weights, bounds, frozen versions, editable descriptions/anchors/evidence requirements and deterministic priority tie-breaks | Later version publication UI and calibration |
| Human decisions | Deterministic totals, approval, AI-difference reasons/provenance, append-only post-release corrections, expected-version concurrency checks, correction outbox and decision history | Accept/reject/reassess controls and resolved-flag workflow |
| Dashboards | Role workspaces, readiness, jobs, delivery, periodic refresh | Realtime subscriptions, search/filter/pagination controls, aggregate exception queues and broader UX checks |
| Results/reports | Private release, public opt-in totals, printable reports, audited CSV | Server-generated private PDFs, signed export artifacts, live revised-decision delivery verification and certificate branding/identity policy |
| Appeals | Time window, criterion/process selection, decision-version binding, append-only organizer response history and linked score corrections | Live hosted participant/organizer checks and additional appeal-notification templates |
| Automation/mail | Durable queue, leases/fencing, retry/dead letters, encrypted invitations, release outbox, signed delivery callbacks | Hosted worker; verified sender; receipt/processing/appeal templates; real delivery/bounce tests |
| Plans/billing | Some team/file/indexing/assessment limits | Organization plan entitlements, event/seat/minute/storage/AI metering, budget enforcement, pilot invoicing and later payments/webhooks |
| Retention/privacy | Recording policy/version and consent records | Actual retention/deletion jobs, backup expiry/legal-hold procedure, request handling and reviewed privacy/terms/subprocessor information |
| Security | RLS, bounded RPCs, secrets server-side, local isolation tests, CSP/API budgets | Hosted IDOR/Auth/Storage/API suite, account abuse controls, MFA, secrets/dependency scans, key rotation and independent review |
| Monitoring/operations | Request metadata logs, durable jobs and health configuration flags | Metrics/traces/alerts, worker freshness and queue-age monitoring, incident/support contacts, backup/restore/rollback drills |
| Release quality | 57 passing local tests and frontend/server build at this audit stage | Desktop/mobile hosted E2E with distinct accounts, accessibility review, 100-user load test, AI golden set and a completed real pilot |

## External setup that code cannot substitute for

1. Choose and connect a long-running API/worker host in the intended region. Configure its secret manager and HTTPS origin; set `VITE_API_URL` and rebuild the frontend.
2. Configure a Gemini account, available generation/embedding models and cost limits. Validate OCR, transcription, diagram extraction, citations and insufficiency handling with synthetic evidence first.
3. Configure a malware scanner and a verified Resend sender/webhook. Configure production Auth SMTP. Validate scanning and real delivery/bounce paths.
4. Supply the business/operator identity, support contact, domain, retention/recording policy and billing decisions needed for public policies and commercial launch.
5. Run the launch gates with separate organizer and participant accounts. Keep the existing pilot private until the participant path is ready.

Secrets belong in hosting secret managers, never chat or the frontend. Do not create an account for another person or invent participant identities to bypass verification.

## Launch gates

Launch stays blocked until the human-only event journey passes on the hosted stack, every intended provider path passes real integration tests, tenant/team/API/storage/export boundaries are verified, retention and recovery work, accessibility/load checks meet agreed targets, public policies/support are ready, and one pilot completes. The PRD's uptime, performance, RPO/RTO and accessibility numbers are targets, not measured guarantees.

The architecture's encryption/compliance/security labels are aspirations. TLS/private storage do not establish end-to-end encryption when server-side AI must read evidence. No GDPR certification, production SLA, fairness guarantee or security certification has been established.
