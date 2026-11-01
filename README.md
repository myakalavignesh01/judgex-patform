# JudgeX · first product milestone

A working React + TypeScript implementation of the core human-scored event journey, based on the supplied production PRD and architecture. This is a browser-local product demo, not a production multi-tenant service.

## Run

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
npm test
npm run build
```

## Try the complete flow

1. Open the organizer dashboard. Explore the queue, rubric, schedule, and approved scorecards.
2. Select **Participant** in the top-right role preview. Edit Nova Labs' project, save a draft, then **Lock & submit**.
3. Return to **Organizer**. Review each pending project, enter all four scores and feedback, and approve.
4. Open **Results**. The release gate blocks until every team has submitted and every scorecard is approved.
5. Release results. Switch to Participant to see the team's scorecard, or export the approved CSV as Organizer.
6. Create a fresh event to try editable rubric weights. The rubric freezes on the first approval.

All sample teams and evidence are synthetic. State is saved in this browser's localStorage. Settings includes a reset action. Use synthetic data only. Role switching is a demonstration, not authentication or authorization.

## Implemented

- Responsive dashboard, submission search/filtering, team cards and read-only presentation schedule.
- Create and switch events with an editable weighted rubric before evaluation.
- Participant draft saving and one-way submission locking with a version and timestamp.
- Evidence review, deterministic weighted scoring (0–10 per criterion, normalized to 100), feedback, approval, and mandatory score-change reasons.
- Release preconditions, immutable released results, participant result visibility, tied score indication, and escaped CSV export.
- Local activity history, empty/error states, reduced-motion support, visible keyboard focus, and labelled forms.
- Domain tests for calculation, rubric validity, score-change reasons, locking, release blocking, and release immutability.

## Not implemented or connected

Supabase Auth, real organizations and memberships, RLS, server authorization, invitations, private uploads, artifact scanning, GitHub ingestion, AI/OCR/transcription, durable workers, email, report PDFs, appeals, billing, quotas, monitoring, backups, legal documents, and production operations. Browser data can be inspected or modified by its owner; the role preview is not a security boundary. The local audit trail is not tamper-proof. Draft saving is explicit, not automatic. Schedules are sample slots in Asia/Kolkata.

## Source map

- `src/domain.ts`: pure scoring and lifecycle functions; synthetic seed data.
- `src/main.tsx`: app shell, organizer views, local persistence, release and export.
- `src/components.tsx`: evidence review, participant workspace, rubric and event forms.
- `src/style.css`: responsive design system and dashboard illustration.
- `tests/domain.test.ts`: business-rule regression tests.
- `docs/NEXT_MILESTONE.md`: backend implementation plan and acceptance gates.

The private Site deploys only the static production bundle. No provider keys are present or required. Sources are retained alongside the build so the UI can be connected to authenticated services in the next milestone.
