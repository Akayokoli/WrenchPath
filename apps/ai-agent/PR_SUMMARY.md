# Proposed title

Add WrenchPath AI career service with Claude tools and persisted learning roadmaps

# Proposed description

Adds an independently runnable TypeScript/Fastify AI service in `apps/ai-agent`. Photon can POST `{conversationId, senderId, message}` to `/api/chat` and receive `{reply}`. The service extracts evidence-backed worker profiles, assesses four automotive career families, builds learning roadmaps, and records explicit user-reported progress. Returning workers resume the next unfinished milestone after a restart.

Claude and OpenAI adapters support structured replies and bounded native tool calls; mock mode supports offline contract testing. Conversation ownership, input validation, atomic local JSON storage, and per-conversation request ordering protect the service boundary. Failed provider turns preserve previous memory. Progress never verifies credentials or authorizes hazardous work.

Validation: 159 automated tests pass, including nine service journey scenarios; TypeScript and production build pass. Six live Claude turns pass concurrent-worker, roadmap, constraints, progress, restart, changed-goal, and missing-information checks. A built-app loopback smoke test passes in mock mode. No lint command is configured. Recognized credential patterns were not found in candidate files; local secrets, conversations, dependencies, and build output are ignored.

Integration limits: Photon/iMessage delivery and live OpenAI behavior are unverified. Run one process per memory directory; storage is plaintext, local, and capped at 50 exchanges. No backend or shared-contract files are changed. See `apps/ai-agent/HANDOFF.md` for setup, timeout/retry considerations, and the proposed Skills Passport snapshot boundary.

Publication status: prepared locally; not pushed, opened as a PR, merged, or deployed. Push approval and PR approval remain separate from this draft.
