# JudgeX requirements status

Status as of 1 November 2026. This is a real-service implementation in development, not a production-complete platform. The existing private Site is the earlier synthetic demo. The real workspace requires the configuration in `PRODUCTION_SETUP.md`.

| PRD area | Implemented in source | Still required |
| --- | --- | --- |
| Website/onboarding | Value proposition, operator setup, email signup/sign-in, event creation/join | Full pricing, FAQ/support, reviewed legal/privacy pages |
| Identity | Confirmed-email requirement, sign-in/out, password recovery, session refresh, database-derived roles | MFA and delegated permissions |
| Tenant boundaries | Organization/event/team model, RLS, bounded RPCs, protected storage, authorization before retrieval | Deployed Auth/Storage tests and expanded IDOR suite |
| Events/problems | Create/publish, registration codes, limits, timezone/deadlines, recording policy, versioned problem statements | Archive, eligibility/capacity and registration-window UI |
| Teams | Email-bound invitation acceptance, encrypted invitation email jobs, revoke, member directory, team-size/duplicate constraints | Decline/resend UX and member management |
| Projects | Autosave, serialized saves, save-before-lock, architecture/repository fields, immutable snapshot/checksum/rubric links | Rich technology/declaration fields and submission revision policy |
| Uploads | Private files, MIME/size/quota checks, scanner adapter, validation states, signed downloads, unlocked-file removal | Scanner configuration, resumable uploads and progress/retry improvements |
| Presentations | Scheduling/check-in, consent, camera/microphone/screen capture, timer, local playback/download/upload | Live conferencing and live captions remain pending; recording-window processing is implemented but unverified with a live provider |
| Vision/transcription | Gemini extraction for slides/images/PDF and consented media, checkpointed video windows, page/timestamp provenance | Provider validation and multilingual quality tests |
| Repository evidence | Public GitHub read-only pinned snapshots, bounded text selection, no execution | Private GitHub App installation flow |
| RAG | Chunks, pgvector, keyword/vector hybrid retrieval, normalized embeddings, submission authorization | Provider setup, retrieval/citation quality evaluation, reindex strategy |
| Agents | Structured assessment, citation/score validation, uncertainty, insufficient evidence, provenance | Independent consistency/feedback stages, calibration and adversarial evals |
| Human decisions | Server-calculated totals, frozen rubrics, score-change reasons and history, atomic release | AI-override linkage, formal anchors/tie-break UI |
| Dashboards | Database-backed role workspaces, evidence, jobs, delivery, scorecards and activity | Pagination, realtime updates, exception filters and real-account UX tests |
| Results/appeals | Time-bound appeals/responses, private scores before release, public opt-in totals, printable scorecards/certificates | Revised released decisions, server PDF artifacts and signed exports |
| Automation | Durable queue, leases/heartbeat/fencing, retries/backoff/dead letters, organizer retry, result outbox | Reminders, separate media scaling, automated report/retention/deletion jobs |
| Email | Resend adapter, logical idempotency, invitation/results, signed callbacks and duplicate receipts | Verified domain, delivery/bounce tests, remaining templates |
| SaaS/billing | Initial server/RPC team/file/indexing/assessment limits | Plan metering, invoicing, payments, budget enforcement and subscriptions |
| Security/governance | RLS, server secrets, untrusted-evidence boundary, consent, local authorization tests | API rate limits/CSP, production security review, rotation/incident/retention procedures |
| Operations | Durable records, recoverable jobs, manual scoring during AI outage | Monitoring/alerts, backups/restore, rollback, load/accessibility checks |
| CI | Frontend/server typechecks, production build, 35 local tests including PostgreSQL access checks | CI confirmation for this revision and deployed-provider E2E tests |

An implemented adapter is not a connected service. Local tests are not production guarantees. No real participant data should be used until external setup and pilot gates are verified.
