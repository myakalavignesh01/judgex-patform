# Connect the real JudgeX workspace

The real workspace is the default entry point. The previous synthetic demo is available only at `/?demo=1`. Production visitors sign in; their event role comes from database membership. They never select permissions using a role switch.

This code needs configured services. Applying migrations or adding keys does not, by itself, certify production readiness. Complete the staging checks below before inviting real participants.

## 1. Supabase development project

Create a Supabase project in your selected region. Keep email confirmation enabled. Configure the Auth site URL and allowed redirect URLs for your frontend. Configure a production SMTP sender before inviting real users; default email delivery limits are intended for development.

Apply every file in `supabase/migrations/` in filename order using the Supabase CLI or SQL editor. Start with a new development project, then repeat the reviewed migrations on staging. Never run these first against an existing production database. The migrations create tenant/event/team records, RPC workflows, row policies, private storage, a durable queue, evidence chunks, and pgvector indexes.

Obtain the project URL and publishable key. These two values are public. Keep the service-role JWT key on the API server only. Do not paste secrets into chat or source control.

## 2. Frontend deployment

Deploy this repository as a Vite frontend on Vercel or another static host. `vercel.json` includes the build and SPA configuration. Set these build environment variables:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Project HTTPS URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable key |
| `VITE_API_URL` | HTTPS address of the API in the next step |

Rebuild after changing frontend variables. With these values configured, users see sign-in and their workspaces directly. The connection form is an operator fallback for an unconfigured build, not a normal participant onboarding step.

## 3. API and worker host

Deploy `Dockerfile` to a managed container host that supports long-running workers. The process exposes HTTP on `PORT` (default 8787) and can run a bounded background worker in the same container for the initial pilot. Run only one worker initially; leases and attempt fencing support recovery. Use a separate worker service for sustained media load.

Configure secrets using the host's secret manager:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Same project URL as the frontend |
| `SUPABASE_PUBLISHABLE_KEY` | Public gateway key |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-only JWT key |
| `APP_ORIGIN` | Exact HTTPS frontend origin, without a path |
| `RUN_WORKER` | `true` for the initial combined API/worker deployment |
| `WORKER_SECRET` | Random secret for optional external `/internal/jobs` invocation |
| `INVITATION_ENCRYPTION_KEY` | 32 random bytes encoded as 64 hex characters |
| `GEMINI_API_KEY` | Google AI provider key |
| `GEMINI_MODEL` | An available multimodal generation model ID selected in your provider account |
| `GEMINI_EMBEDDING_MODEL` | An available embedding model supporting 768 dimensions; omit for keyword-only retrieval |
| `RESEND_API_KEY` | Restricted email-sending key |
| `RESEND_FROM` | Sender on your verified domain |
| `RESEND_WEBHOOK_SECRET` | Signing secret from the Resend endpoint configuration |
| `MALWARE_SCAN_URL` | HTTPS endpoint for your isolated malware scanning service |
| `MALWARE_SCAN_TOKEN` | Scanner API credential |

The scanner receives raw file bytes by authenticated POST and must return JSON `{ "clean": true }` only after a successful scan. It must reject malware, timeouts, and unsupported formats. Without a scanner, uploads remain pending and cannot be locked into a submission. Text-only project submissions can still run the human-scored flow.

The server supports small, bounded media requests. Its current Gemini inline extraction path accepts at most 15 MB per source. Larger uploaded files remain preserved but require manual review or a separately implemented segmented processing path. Do not advertise long-video automation yet.

Check `/health` for connection configuration flags. This endpoint reports configuration presence, not provider account validity or successful delivery.

## 4. Email delivery

Create and verify a Resend sending domain, including its required DNS records. Configure a webhook at `https://YOUR_API/webhooks/resend` for `email.sent`, `email.delivered`, `email.bounced`, and `email.failed`. Save its signing secret on the API host.

Invitation tokens are stored encrypted in queued email payloads. Result emails are created only by the transactional release RPC. Provider idempotency keys protect repeated sends within the provider's supported retention window. Webhook signatures and timestamps are verified by the Svix SDK; database receipts prevent duplicate application of a webhook.

## 5. Verify with separate accounts

1. Sign up an organizer and verify its email. Create an event, configure deadlines/rules and rubric, then publish registration.
2. Sign up two unrelated participants. Join using the event code, create separate teams, and verify neither account can read the other team's records or files.
3. Invite a third account to one team. Verify that accepting while signed in with a different email fails; accepting with the intended verified account creates membership.
4. Save project content. Upload a small clean PDF or image, pass scanning, then lock. Verify post-lock edits fail at the RPC layer.
5. Use camera/screen capture only after consent. Inspect the recording locally, upload a small source, then confirm timestamped extraction evidence is created. Test refusal and device failure.
6. Run the worker. Import a public repository snapshot, request an assessment, and inspect evidence citations, uncertainty and limitations. Test invalid provider output and provider outage.
7. Approve all scorecards. Try releasing before every approval and verify rejection. Release once, then repeat the request and verify no duplicate logical notifications.
8. Confirm participants see only their released scorecards. Print scorecards/certificates to PDF, submit an appeal within the configured deadline, and inspect the organizer response.
9. Verify actual delivery and bounce webhook events. Test worker crash, timeout, retry exhaustion, and operator retry.
10. Complete backup/restore, dependency and security review, load testing, accessibility review, retention/deletion procedures, and rollback before a real pilot.

## Operational limits still requiring work

See `REQUIREMENTS_STATUS.md`. This is an implementation in progress. Automated retention/deletion, adaptive video segmentation, private GitHub App installation flow, billing, full legal pages, monitoring integrations, and production recovery drills remain pending. The repository must not be described as a complete production-certified platform until those items and external-provider tests are completed.
