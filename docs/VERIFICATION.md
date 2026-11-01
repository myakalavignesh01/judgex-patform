# Milestone verification

## Real workspace update — 1 November 2026

- Production frontend at `https://judgex-platform.vercel.app/` now uses build-time Supabase public configuration and opens directly to sign-in.
- Supabase schema deployment and GitHub CI succeeded. Password recovery and actionable authentication error messages were deployed.
- A verified real account created `JudgeX Pilot - Workflow Check`, received organizer membership, saved a versioned problem statement and reloaded persisted event data.
- The live database rejected a rubric total of 101%; restoring 100% saved successfully. The pilot event remains a private draft with registration unpublished and no team results.
- Frontend/server builds pass. The local suite now contains 57 passing tests, including database authorization, storage boundaries, immutable submissions, release idempotency, recovery links, media-window bounds and stale worker-token rejection.
- Event lifecycle transitions passed local authorization and released-scorecard retention tests; hosted verification is pending deployment.
- Separate AI assessment, consistency and feedback stages passed failure/resume, citation rejection, stage-order and stale-lease checks with local fixtures. Live Gemini behavior remains unverified.
- Completeness audit fixes passed event-window/deadline preservation, project-detail snapshot, AI-difference provenance, invitation-decline, session-refresh concurrency, API-budget, closed-event and export authorization checks. Local component checks passed; hosted multi-account checks remain pending.
- Presentation tests cover room overlap, notification idempotency/supersession, state permissions, immutable Q&A/checksum, rubric guidance and priority tie-breaks. Local component QA verified saved date values and schedule form interaction with synthetic fixtures, no console warnings/errors, and no mobile horizontal overflow (375 CSS-pixel content/client widths). This does not replace a hosted multi-account test.
- Post-release revision checks cover original preservation, team isolation through the invoker-security current-scorecard view, stale-write rejection, idempotent notices, public/export consistency, version-bound appeals and history. Specialist checks cover deterministic medians, missing evidence, invalid citations, criterion assignment and failure/resume.
- The five-reviewer workflow and released-decision history/correction form were rendered from actual components with labelled synthetic fixtures. Mobile content/client widths both measured 375 CSS pixels; browser logs contained no errors or warnings. No production score or real participant record was changed.
- Gemini/Resend/scanner calls remain unverified with real accounts. The API/worker host is not yet connected. No real camera/microphone recording or participant result delivery has been tested.

The notes below describe the earlier synthetic demo.

Verified on 1 November 2026.

- TypeScript strict typecheck and production Vite build passed.
- Five domain tests passed: weighted scores and bounds; rubric weights; approval prerequisites and override reasons; immutable submission locking; blocked/idempotent release and released-score immutability.
- npm dependency audit reported zero known vulnerabilities after updating Vite to 6.4.5.
- Production preview returned HTTP 200 and rendered without browser console errors.
- Browser flow passed: create QA Pilot event, switch to participant, save draft, lock submission, verify release is disabled, enter four scores of 8 with feedback, approve, release, and verify participant scorecard displays 80/100.
- Desktop dashboard inspected at 1440px; mobile dashboard inspected at 390px. Mobile document and viewport widths both measured 390px, with no horizontal overflow.

The Vite development optimizer encountered a sandbox parent-directory read restriction on this Windows host. Browser checks used the successful production build via `npm run preview`. This is a preview-environment limitation, not a verified development-server fix.

These checks cover the local demo. No Supabase integration, authorization, real email delivery, upload pipeline, load test, formal accessibility audit, or production recovery test has been performed.
