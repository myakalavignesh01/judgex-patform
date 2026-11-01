# JudgeX internal evaluation workflow

The user-supplied flow and JUDGEX LEO reference guide this implementation. The reference presentation screen provides camera/microphone/screen recording controls and its score screen waits for a successful backend response. Local recording does not establish a remote meeting or live captions.

## Participant and organizer paths

Participants join a verified team, save project details, present or supply permitted evidence, answer project-defence questions and lock an immutable submission. Organizers use the event-scoped evaluation view to inspect evidence and approve decisions. Judge/Admin is the organizer workspace, not a public permission switch.

## Evidence to analysis

1. Intake validates uploads, scanning state and immutable submission metadata. Public repositories are imported as bounded, pinned, read-only snapshots.
2. Extraction adapters collect slide text, OCR, diagram/chart relationships and consented presentation transcripts with page/timestamp references. Video uses durable processing windows.
3. Evidence is chunked and indexed. Retrieval authorizes the submission first, then uses keyword search and optional pgvector embeddings. Without an embedding model it is keyword retrieval, not semantic RAG.
4. Five bounded specialist stages review assigned rubric criteria: Technical, Innovation, UX, Product and Impact. An omitted assignment selects all five; a stage with no assigned criteria is explicitly skipped. Separate model calls use fixed perspectives and untrusted-evidence instructions; they are not independent human judges.
5. Every specialist response must contain exactly its assigned criteria, bounded suggested scores, known evidence citations, uncertainty and limitations. Unknown citations or malformed responses fail the stage.
6. The rubric engine combines each criterion's supported suggestions using the median. Null means insufficient evidence and is not converted to zero. Partial support raises uncertainty. A spread of at least three points is a review flag, not a penalty or a validated fairness measure.
7. Separate consistency and feedback stages review the combined output. Successful stages are checkpointed, retries retain their results, and expired worker leases cannot overwrite progress. Existing legacy runs remain readable. Model configuration must match the stored run when resuming.
8. The organizer approves final criterion scores and feedback. PostgreSQL calculates weighted totals and enforces the frozen rubric. Differences from available AI suggestions require a recorded reason. AI stages cannot approve or release.
9. Authorized release creates result-notification jobs. Participants see their own released results. CSV exports and public opt-in totals use human-approved decisions.

RAG is the evidence-retrieval layer; there is no invented standalone “RAG score.” Rubric scores are suggestions until an organizer approves them. The full golden-set quality evaluation, citation relevance testing and calibration remain pending.

## Corrections and appeals

Released scorecards stay immutable. Corrections append a new decision revision, preserve the original, require a public reason and expected version, and atomically queue verified-team notices. Repeating an identical successful revision request does not duplicate versions or notices. The current-result view, reports, exports and public totals read the latest revision; decision history preserves earlier versions. Appeals bind to the current decision version and criterion/process issue, with append-only organizer response history.

## What is and is not operational

The frontend and database deployment are separate from provider execution. AI, computer vision/transcription, semantic embeddings, malware scanning and email delivery need the API/worker host and valid provider configuration. Local tests use synthetic fixtures and do not certify model quality, device capture or email delivery. Live conferencing/captions, private-repository authorization, billing, retention automation and production launch gates remain in the readiness audit.
