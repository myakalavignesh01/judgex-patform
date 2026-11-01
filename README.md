# JudgeX

Hackathon operations and evidence-assisted evaluation: authenticated event/team workspaces, project submissions, consent-led presentation capture, private evidence, bounded AI processing, human approval and result release.

The default app is the real-service workspace. It needs Supabase and an API/worker deployment. Without configuration it displays operator setup. The original synthetic demo remains at /?demo=1.

## Run locally

Requires Node.js 24 and npm.

    npm ci
    npm run build
    npm test
    npm run preview

Use npm run dev for development. Copy .env.example to an untracked .env and configure server values before npm run api. The container uses host-managed secrets.

## Connect services

Follow [production setup](docs/PRODUCTION_SETUP.md). Supabase GitHub integration Working directory is a single dot (.) because supabase/ is at the repository root. Migrations are in supabase/migrations/ and CLI configuration is supabase/config.toml.

Public frontend build values are VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_API_URL. Provider keys and the service-role JWT key belong only on the API/worker host. Never commit an .env file.

## Included workflows

- Verified signup/sign-in, database-derived roles, events, versioned problem statements and registration.
- Teams, email-bound invitations, autosaved drafts, private artifacts and immutable submission versions.
- Consent-led camera/microphone/screen recording, check-in, scheduling and manual evidence alternatives.
- Public GitHub snapshots, Gemini visual/audio/text extraction, embeddings, authorized hybrid retrieval and validated AI suggestions.
- Human approval, atomic result release, queued delivery, signed callbacks, appeals, opt-in public results and printable reports/certificates.
- Durable jobs with retries, leases, attempt fencing, dead-letter recovery and activity history.

## Current limits

This is an implementation in progress. Service accounts, real provider tests, production monitoring, automated retention, long-media segmentation, billing, recovery/accessibility/load tests and other PRD items remain pending. Exact status: [requirements status](docs/REQUIREMENTS_STATUS.md).

Small sources use inline extraction. Video and larger sources use the provider Files API, with checkpointed two-minute video windows. The default processing limit is 15 minutes per recording, configurable up to one hour; these adapters still need live-provider verification. Private GitHub installation access and live video conferencing are not implemented. No face, gaze, emotion, appearance or accent scoring is used.

## Source structure

- src/platform/: authenticated UI, operator setup, presentation capture and service client.
- src/main.tsx and src/domain.ts: entry point and preserved synthetic demo.
- server/: Node API, durable worker, Gemini/GitHub/Resend adapters and webhooks.
- supabase/: PostgreSQL schema, RLS, RPCs, private storage and retrieval.
- tests/: domain, provider-boundary and PostgreSQL authorization tests.
- docs/: setup, requirement status and verification notes.

The test database emulates Supabase identity functions and storage metadata around embedded PostgreSQL. It does not replace deployed Auth, Storage or provider tests.
