# JudgeX requirements status

Status as of 1 November 2026. This is a real-service implementation in development, not a production-complete platform. The existing private Site is the earlier synthetic demo. The real workspace requires the configuration in `PRODUCTION_SETUP.md`.

| PRD area | Implemented in source | Still required |
| --- | --- | --- |
| Website/onboarding | Value proposition, operator setup, email signup/sign-in, event creation/join | Full pricing, FAQ/support, reviewed legal/privacy pages |
| Identity | Confirmed-email requirement, sign-in/out, password recovery, session refresh, database-derived roles | MFA and delegated permissions |
| Tenant boundaries | Organization/event/team model, RLS, bounded RPCs, protected storage, authorization before retrieval | Deployed Auth/Storage tests and expanded IDOR suite |
| Events/problems | Create/publish, close/reopen registration, archive/restore, registration codes, team/capacity limits, eligibility text, event format, registration windows, timezone/deadlines, recording policy, versioned problem statements | Eligibility verification, public event discovery and date-boundary E2E checks |
| Teams | Email-bound invitation acceptance, encrypted invitation email jobs, decline/revoke, member directory, team-size/duplicate constraints | Resend UX and member management |
| Projects | Autosave, serialized saves, save-before-lock, problem/solution/architecture/technology/impact/declaration/demo/repository fields, immutable snapshot/checksum/rubric links | Submission revision policy and validation refinements |
| Uploads | Private files, MIME/size/quota checks, scanner adapter, validation states, signed downloads, unlocked-file removal and validation retry | Scanner configuration, resumable uploads and progress/retry improvements |
| Presentations | Conflict-checked versioned slots, queue states, opt-in schedule/reminder jobs, check-in, project-defence snapshots, browser support check, consent, camera/microphone/screen capture, timer, local playback/download/upload | Live conferencing and live captions remain pending; recording-window processing is implemented but unverified with a live provider |
| Vision/transcription | Gemini extraction for slides/images/PDF and consented media, checkpointed video windows, page/timestamp provenance | Provider validation and multilingual quality tests |
| Repository evidence | Public GitHub read-only pinned snapshots, bounded text selection, no execution | Private GitHub App installation flow |
| RAG | Chunks, pgvector, keyword/vector hybrid retrieval, normalized embeddings, submission authorization | Provider setup, retrieval/citation quality evaluation, reindex strategy |
| Agents | Five checkpointed Technical/Innovation/UX/Product/Impact reviewer stages, criterion assignments, deterministic median combination, consistency review and feedback stages; citation/score validation, uncertainty, insufficient evidence, provenance and lease-checked retry checkpoints | Live provider validation, calibration and adversarial evals |
| Human decisions | Server-calculated totals, frozen rubrics with descriptions/anchors/evidence guidance and deterministic priority tie-breaks, required AI-difference reasons, linked assessment provenance and score-change history, atomic release | Explicit reassessment controls and published later rubric versions |
| Dashboards | Database-backed role workspaces, evidence, jobs, delivery, scorecards, activity, readiness checklists, event-filtered paginated reads and 30-second refresh | True realtime subscriptions, exception filters and real-account UX tests |
| Results/appeals | Time-bound appeals/responses, versioned post-release corrections with preserved originals, version-bound appeals and response history, private scores before release, public opt-in totals, printable scorecards/certificates and audited approved-results CSV exports | Server PDF artifacts, signed exports and live correction-email verification |
| Automation | Durable queue, leases/heartbeat/fencing, retries/backoff/dead letters, organizer retry, result outbox | Separate media scaling, automated report/retention/deletion jobs |
| Email | Resend adapter, logical idempotency, invitation/schedule/reminder/results templates, signed callbacks and duplicate receipts | Verified domain, delivery/bounce tests, remaining templates |
| SaaS/billing | Initial server/RPC team/file/indexing/assessment limits | Plan metering, invoicing, payments, budget enforcement and subscriptions |
| Security/governance | RLS, per-user API budgets, bounded pre-auth request limits, CSP, server secrets, untrusted-evidence boundary, consent, local authorization tests | Distributed edge abuse controls, production security review, rotation/incident/retention procedures |
| Operations | Structured request metadata logs, durable records, recoverable jobs, manual scoring during AI outage | Monitoring/alerts, backups/restore, rollback, load/accessibility checks |
| CI | Frontend/server typechecks, production build, 57 local tests including PostgreSQL access checks | CI confirmation for this revision and deployed-provider E2E tests |

An implemented adapter is not a connected service. Local tests are not production guarantees. No real participant data should be used until external setup and pilot gates are verified.
