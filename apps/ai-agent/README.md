# WrenchPath ATL AI service

Milestones 2–7 complete; GitHub handoff prepared. See [HANDOFF.md](HANDOFF.md) for teammate setup and [PR_SUMMARY.md](PR_SUMMARY.md) for the proposed PR description. Native Claude/OpenAI tools retrieve profiles, assess skills, generate roadmaps, select the next milestone, and record explicit user-reported learning progress. The default mock mode still returns the Milestone 2 static reply.

## Run locally

Use Node.js 26 and npm. From the repository root:

```sh
cd apps/ai-agent
npm ci
cp .env.example .env
npm run dev
```

The service defaults to `http://127.0.0.1:4000`. `PORT` accepts an integer from 1 to 65535; `HOST` defaults to `127.0.0.1`. The server loads an optional `.env` in the current working directory; existing environment variables take precedence. Mock mode needs no credentials. Claude or OpenAI mode requires the corresponding API key. Keep `.env` out of Git.

```sh
npm test
npm run typecheck
npm run build
npm start
```

`dev` reloads on source changes. `build` produces JavaScript in `dist`; `start` runs that build. Stop with Ctrl+C for graceful shutdown.

## HTTP contract

```sh
curl http://127.0.0.1:4000/health
curl -i http://127.0.0.1:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"conversation-123","senderId":"worker-123","message":"I have worked at a tire shop for two years."}'
```

Health returns HTTP 200 with `{"status":"ok"}`. In mock mode, chat returns HTTP 200 with:

```json
{"reply":"Welcome to WrenchPath ATL. What type of automotive role would you like to move into?"}
```

All three request fields must be strings. After trimming outer whitespace, IDs must contain 1–200 characters and messages 1–4000 characters (JavaScript string length). Extra fields are rejected. Request bodies are limited to 16 KiB, so a message with many multibyte characters can reach the body limit before the character limit.

Errors use `{"error":{"code":"...","message":"..."}}`. Validation errors additionally contain a `fields` array naming invalid fields without echoing their values.

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Missing, unexpected, or invalid fields |
| 400 | BAD_REQUEST | Malformed or empty JSON |
| 413 | PAYLOAD_TOO_LARGE | Body exceeds 16 KiB |
| 415 | UNSUPPORTED_MEDIA_TYPE | Use application/json |
| 404 | NOT_FOUND | Unknown endpoint |
| 500 | INTERNAL_ERROR | Unexpected service failure |

The Photon backend on port 3000 should POST the three fields to this service and send the successful `reply` to iMessage. It must check HTTP status before reading `reply`. Error handling and retry behavior on the backend remain a team integration task. This service is intended for trusted local use: sender IDs are not authentication, and it should not be exposed publicly without an approved access-control design.

## How the code works

`server.ts` loads configuration and starts the listener. `app.ts` assembles the application independently of a network port, allowing request tests. `routes/chat.ts` validates JSON using `schemas/chat.ts`, passes the validated request to a chat service, and returns the agreed response. `services/mock-chat.ts` supplies the static reply. `errors.ts` maps failures to readable JSON without returning exception details. Request bodies and worker identifiers are not logged by the application.

Tests cover HTTP behavior, validation boundaries, service failures, and configuration. These are local service tests, not Photon/iMessage integration tests. A separate build configuration keeps test files out of the production output. There is no lint configuration in this milestone.

## Enable AI conversations

In your ignored `.env`, set:

```dotenv
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-5-5
ANTHROPIC_API_KEY=your-key-here
AI_TIMEOUT_MS=20000
MEMORY_DIR=data/conversations
```

Supply the key locally; never paste it into chat or commit it. Stop and restart `npm run dev` after changing `.env`. The startup log reports `provider: anthropic`, `provider: openai`, or `provider: mock`. In either live provider mode a missing matching key stops startup with a configuration error; API errors never silently switch to the mock. `AI_TIMEOUT_MS` accepts 1000–120000 milliseconds. The configured model must be available to your API account and support that provider’s structured outputs. For Claude, remove the old `AI_MODEL=gpt-5.6-terra` line or replace it with `AI_MODEL=claude-sonnet-5-5`; startup rejects cross-provider model names. Do not copy `.env.example` over an existing `.env` containing your key.

Send multiple requests using the same `conversationId` and `senderId` to continue a conversation. The response still contains only `reply`; the internal intent label does not alter the shared contract. This milestone provides a preliminary skills assessment and saved roadmap, with progress-update tools, but no live training-program search.

The optional OpenAI adapter follows the [Responses text guidance](https://developers.openai.com/api/docs/guides/text) and [structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs). The default model is configurable; see [model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra). Schema validation checks structure and length, not factual truth or semantic safety; those need live evaluation too.

## Conversation flow and failure behavior

1. `services/create-chat.ts` selects the explicit mock, Anthropic, or OpenAI mode.
2. `conversation/engine.ts` queues requests within each conversation, loads history, and checks sender ownership. Other conversations can proceed independently.
3. The provider first extracts a profile from indexed USER messages. `profiles/extract.ts` checks cited quotes and fact values; `skills/assess.ts` calculates the assessment and `roadmaps/generate.ts` builds a plan when a supported goal and some background are known. Then `providers/anthropic.ts` sends instructions, assessment context, and saved history to Claude’s Messages API; `providers/openai.ts` uses OpenAI’s Responses API. Identifiers are not sent as separate model fields. Worker message text is sent to the selected provider.
4. The adapter and engine validate the intent and reply (1–700 characters). The model is instructed to use 1–3 short sentences and ask one missing question.
5. The engine persists the profile, assessment, roadmap, and both messages together only after a valid response. It returns only `reply` to the caller.

Both providers use a configurable timeout and no automatic SDK retries. The OpenAI adapter additionally uses `store: false` to avoid requesting persistent Responses storage. The Claude adapter uses Messages requests without that OpenAI-specific field. Neither configuration is a claim of zero provider retention. We do not log message text or API errors that may include private content.

Provider failures, refusals, incomplete or invalid outputs, and storage failures produce HTTP 200 with a brief retry `reply`. No successful turn is recorded for failed requests. This preserves the agreed response contract; the backend must not interpret HTTP 200 as proof that the model answered. HTTP input errors still use the existing error objects. A different sender reusing a conversation ID receives a generic unavailable-conversation reply before the provider is called.

## Local memory limits

`storage/json-store.ts` writes one versioned JSON file per hashed conversation ID, stores a hashed sender ID for ownership checks, and writes temporary files before atomic replacement. New files use mode 0600 and new storage directories mode 0700. Hashes avoid raw IDs in filenames; they are not encryption. Message text remains plaintext. Use opaque backend IDs rather than phone numbers where possible.

Run one AI-service process against a storage directory. Per-conversation ordering is in-process; multiple processes sharing the directory are unsupported. Corrupt or unreadable files cause a safe reply and are preserved rather than overwritten.

Complete history is retained up to 50 successful exchanges per conversation. At that limit, the service asks for a new conversation rather than silently forgetting older facts. There is no automatic retention expiry or deletion endpoint yet. For the local demo, stop the service and remove the relevant file from `data/conversations` to clear a conversation. A new conversation ID starts fresh. Changing `MEMORY_DIR` requires keeping the destination outside tracked source or adding an appropriate ignore rule.

## Tests and live verification

`npm test` makes no real API calls. It tests the SDK adapter using fake HTTP responses, multi-turn context, sender/conversation isolation, concurrency, persistence after restart, corrupt storage, context limits, timeouts, invalid responses, and provider failures. The mocked replies do not prove the real model's conversational quality or safety.

Once the key is configured, run:

```sh
npm run test:live
```

This opt-in check makes four synthetic turns, each with one extraction request and up to seven response/tool rounds using synthetic worker messages. It uses and cleans up a separate temporary memory directory, leaving your server's conversation files alone. It tests a tire-shop worker, weekend availability, a restart before recall, and a second worker with no history. Review the printed replies for accurate recall, one useful question, concise language, safe EV guidance, and no invented qualifications. A provider failure makes the script exit unsuccessfully; completion still requires human review of the replies. It does not send iMessages.

The four synthetic Claude profile scenarios passed during Milestone 4, including persistence, corrected goals, and isolation. Automated tests use fake credentials and simulated HTTP responses. OpenAI extraction has automated adapter coverage but has not been verified against a live OpenAI account. Milestone 6 tool calling and progress support is described below.


## Claude configuration details

Claude uses `ANTHROPIC_API_KEY`; leave `OPENAI_API_KEY` empty when using Claude. Only the selected provider's key is passed to its SDK. If `AI_MODEL` is absent, Claude defaults to `claude-sonnet-5-5` and OpenAI defaults to `gpt-5.6-terra`. `AI_PROVIDER` defaults to `mock` until explicitly changed. To use OpenAI instead, set `AI_PROVIDER=openai`, its own key, and remove or replace the Claude model setting.

The Claude adapter uses [JSON structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), checks for a completed `end_turn`, extracts text blocks, then applies the same reply and intent validation as the OpenAI adapter. Refusals, truncated responses, and invalid tool sequences become the engine's safe retry reply without recording a partial conversation.

For the default [Sonnet 5.5 model](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), the adapter uses `thinking: {type: "between_tools"}` to avoid up-front thinking for short replies. Native tool calls preserve the full assistant content, including thinking blocks, when returning results. Other configured Claude models use their default thinking behavior and must support JSON structured outputs; their availability and latency need separate live verification.

`npm run test:live` respects your selected provider and rejects mock mode. It never forces OpenAI or silently uses a different key. From `apps/ai-agent`, edit `.env`, restart `npm run dev`, and run the live check in a second terminal. Each turn makes one extraction request and up to seven response/tool rounds.


## Live-check troubleshooting

The live check reports fixed diagnostic descriptions rather than raw SDK errors, keys, headers, or worker messages. HTTP 401 means the selected provider rejected the credential; verify the matching API key in `.env` and check for an older exported environment variable (shell values take precedence). HTTP 403 indicates permissions, 404 indicates an unavailable model or endpoint, BILLING indicates provider credit/billing problems, and 429 indicates rate/quota limits. TIMEOUT and CONNECTION identify request timeout and connectivity failures. The iMessage-facing retry response remains unchanged.


## Worker profiles and skills assessment

`profiles/schema.ts` defines nine optional fact categories: current role, experience duration, education, certifications, target career, city/region, training budget, availability, and learning preference. Values preserve the worker's words (for example, "two years"); duration and budget are not converted into guessed numerical values. Each fact and skill has a user-message index and exact supporting quote. Credentials remain user-reported, never verified.

`updateProfile(previous, extraction, messages)` validates evidence against user messages, rejects fabricated quotes/values, and merges the newest sourced entries while retaining unrelated older facts. Explicit fact retractions are stored with a null value; old source indices cannot overwrite newer corrections. The model is instructed to distinguish first-person claims, aspirations, negations, and other people's experience. A conservative vocabulary/negation check rejects several common unsupported skill claims. These checks do not prove that every semantic interpretation is correct. Ambiguous phrasing, multilingual statements, and complex negations may require clarification or result in the safe retry reply.

`assessSkills(profile)` is a deterministic TypeScript function. It maps four supported target families (vehicle inspector, reconditioning technician, automotive service technician, EV service technician) to preliminary learning areas. It returns:

- `existingSkills`: explicit user-reported experience, never inferred from title or duration.
- `transferableSkills`: reported skills relevant to the chosen learning areas.
- `skillGaps`: explicitly reported lack of experience.
- `learningSkills`: areas being studied, without a competence claim.
- `unknownSkills`: areas not established, with a clarification question.
- Explanations, precautions/prerequisites, source links, and `qualificationStatus: not_verified`.

An unsupported or unspecified target prompts clarification instead of guessing a role. These lists are WrenchPath's preliminary learning mappings, not universal employer requirements, a licensing assessment, or an ASE assessment. Reported high-voltage experience never grants authorization for hazardous work. Oil-service experience transfers general maintenance habits; it does not imply battery EVs need engine oil changes.

Source review (2026-10-10): [ASE test series](https://ase.com/tests/ase-certification-test-series/) informs general automotive learning areas; [ASE xEV safety](https://ase.com/tests/x-ev/) distinguishes awareness from technician safety preparation; [O*NET automotive technicians](https://www.onetonline.org/link/summary/49-3023.00) supports inspection, maintenance, repair, diagnosis, and documentation areas. The assignment of these areas to our four role families, especially reconditioning, is our design interpretation. No local programs, credential eligibility, prices, or hiring requirements have been inferred from these sources. Employer-specific criteria require further verification.

Storage schema version 1 now has additive nullable `profile` and `assessment` fields. Older files load with null values and are enriched on the next successful live turn from their existing user-message history. No destructive migration runs. Only the last successful profile/assessment is stored; its evidence remains tied to the retained history.

Each live turn makes one extraction call and up to seven response/tool rounds, increasing latency and cost. The configured timeout applies to each call separately. Extraction failures, unsupported evidence, or reply failures preserve the previous saved state. Mock mode continues to be static and does not perform extraction.

Run `npm run test:profiles:live` for four synthetic scenarios (up to eight paid calls per turn): an entry-level EV seeker with weekend/budget constraints and no certifications, a corrected goal after service recreation, an experienced mechanic seeking reconditioning, and a separate user with no known facts. It checks saved data as well as replies, uses temporary storage, and removes it afterward. It does not inspect or modify real worker conversations.


## Personalized roadmaps (Milestone 5)

`roadmapReadiness(profile)` requires a supported target plus at least one background fact (current role or experience duration) or explicitly reported skill state. If those are absent, the model asks a missing question and no plan is stored. Unknown budget and availability are allowed but are labeled unknown; the plan asks the worker to confirm them before committing to paid training.

`generateRoadmap(profile)` returns a schema-validated plan using `roadmaps/catalog.ts`. It includes transferable skills, explicit gaps, unknown skills, ordered milestones, practical actions, evidence to collect for learning review, source URLs, credential references, budget/schedule guidance, and a first action. The catalog sequence is our educational design, not a credential authority's mandated sequence. Evidence to collect is a learning exercise, not official assessment or proof of certification.

Every skill milestone has a mode: learn (explicit gap), continue_learning (reported study), review (reported experience), or clarify (unknown). All start as `not_started`. Experienced workers receive review tasks rather than introductory tasks where they have reported relevant experience. They never automatically pass safety milestones. EV plans put safety awareness before electrical learning and diagnostics, and require qualified supervision before hazardous practical work. No high-voltage procedures are provided.

Budget and availability remain the worker's exact phrases. The plan uses them to guide study windows and cost checks; it does not infer a numeric spending allowance, a guaranteed duration, or that a program fits the budget. Initial written exercises/readings precede a decision about paid training. Learning preferences inform format selection when known. No enrollment or spending occurs.

The only named credential reference currently included is [ASE xEV Electrical Safety Awareness Certification (Level 1)](https://ase.com/tests/x-ev/), for EV plans. It is an option to investigate, not an eligibility claim, a mandatory job requirement, or an awarded qualification. Other role plans ask an employer/instructor which credentials apply rather than inventing one. Official scope and general task references were reviewed on 2026-10-10; live local availability and costs have not been verified.

The conversation engine recalculates the roadmap deterministically after profile extraction and gives it to the model as explanation context. There are still two model calls per turn; roadmap generation adds none. The HTTP contract remains `{reply}` and the full structured plan stays in local conversation storage. On roadmap requests, the model is instructed to give a concise ordered overview and a practical first step. Facts, plan, and conversation are saved together only after a valid reply. A goal change replaces the active plan; an unsupported or retracted goal clears it. Old conversation files load with `roadmap: null` and gain a plan on the next eligible successful turn.

Milestones begin as `not_started`. Milestone 6 adds `in_progress` and `user_reported_complete`, preserving progress for matching milestone IDs and learning objectives when a plan is regenerated. A changed career goal starts a fresh plan. The app does not award qualifications or promise employment.

Run `npm run test:roadmaps:live` to check a novice EV seeker with weekend/$100 constraints, an experienced EV seeker, and a changed goal after recreating the service. The check uses temporary data, validates the saved plans, prints summaries for review, and makes up to six paid model requests. It does not test Photon/iMessage.

Milestone 5 validation: 123 automated tests passed, along with TypeScript checking and the build. Three live Claude roadmap scenarios passed after the experienced-worker fixture was clarified to state electrical-fundamentals knowledge explicitly. The earlier phrase "electrical diagnostics" had been categorized as diagnostic experience without separately asserting electrical fundamentals; the app correctly left the latter unknown. Live checks confirmed different learn/review modes, retained budget and availability, persisted plans across service recreation, and replacement after a goal change. These results do not establish official qualification, general model reliability, or Photon integration.


## Tools and learning progress (Milestone 6)

Five native tools are available: `get_worker_profile`, `assess_skills`, `generate_roadmap`, `get_next_milestone`, and `update_learning_progress`. The first four accept no arguments. Progress updates accept a milestone ID, status, and exact evidence quote. Tools bind to the current conversation in the server; the model cannot select another sender or conversation.

Flow: request → load memory → extract supported profile facts → assess and reconcile roadmap → model tool calls → validate final reply → atomically save history, profile, assessment, and progress. Tool changes stay in memory until a valid final reply exists. Provider failures discard the entire staged turn. Each turn allows seven response rounds and six tool calls at most, plus one profile extraction request. Each tool is exposed once per turn; updating progress re-enables the next-step lookup. Repeated calls to an unavailable tool fail safely. Tool use increases API cost and latency relative to earlier milestones. Timeouts apply per API request.

For example, after a roadmap exists, “I finished EV safety awareness” can mark that milestone `user_reported_complete`. “What's my next step?” then returns electrical fundamentals. “Done” requires clarification. Only one explicit update is accepted per turn. A new or changed roadmap requires a separate progress message; the update tool is hidden until then. It is also hidden unless the latest message explicitly reports the worker’s own progress or requests a reset, preventing older reports from being applied during next-step questions. English evidence checks reject common hypothetical, negative, and third-person reports; these checks are conservative and do not constitute general language understanding or proof of completion. Unsupported wording may require clarification.

Progress stores the exact user quote and message index. The next step is the first unfinished milestone, so reporting a later step complete cannot skip an unfinished prerequisite. A deterministic acknowledgement reports what was actually saved. Completing all steps never grants a credential or authorizes hazardous work.

Important files:
- `src/tools/definitions.ts`: model-visible tool schemas and instructions.
- `src/tools/runtime.ts`: argument and evidence validation, conversation-bound tool execution.
- `src/roadmaps/progress.ts`: progress reconciliation and next-step selection.
- `src/conversation/engine.ts`: staged tool execution and atomic persistence.
- `src/providers/anthropic.ts` and `openai.ts`: bounded native tool loops.
- `src/tools/passport.ts`: detached, versioned local Skills Passport snapshot interface. This is a proposed handoff shape, not a shared API or external synchronization service.

Run the synthetic live progress check from `apps/ai-agent`:

```bash
unset ANTHROPIC_API_KEY # If a stale shell key overrides the intended .env key
npm run test:progress:live
```

It uses temporary disk storage, recreates the service between turns, and checks completion, returning-user next step, ambiguous progress, and a changed goal. Temporary data is removed on exit. It does not test Photon/iMessage delivery. Native protocol tests cover both providers with simulated HTTP responses; live OpenAI tool use has not been tested.

Milestone 6 validation: 149 automated tests passed, including native Claude/OpenAI tool round trips, repeated-call rejection, progress validation, failed-turn rollback, and hiding writes on new goals. TypeScript checking and build passed. Four live Claude scenarios passed: explicit completion, correct next step after service recreation, ambiguous completion without advancement, and a new inspection roadmap after a goal change. Early live attempts exhausted the tool budget due to repeated lookups; restricting tool availability fixed the observed repeats. A confusing goal-change progress clarification was corrected by hiding the update tool during goal changes. These synthetic checks do not establish general model reliability or verified qualifications.

## End-to-end service journeys (Milestone 7)

`tests/journeys.test.ts` exercises the HTTP route, real Claude SDK adapter with simulated provider HTTP responses, evidence validation, assessment, roadmap tools, and temporary JSON storage together. It covers all nine required journeys:

| Journey | Verified behavior |
| --- | --- |
| Entry-level tire worker seeking EV work | Tire/oil skills transfer; EV safety comes before electrical learning. |
| Experienced mechanic seeking reconditioning | Reported skills receive review steps; unknown detailing experience stays unknown. |
| No formal certifications | A learning plan is available without inventing or awarding qualifications. |
| Limited training time | Weekend availability persists across turns and remains in the roadmap. |
| Changed career goal | The plan changes to inspection; unrelated availability remains; progress starts fresh. |
| Returning worker | After service recreation, disk-backed progress selects the next unfinished milestone. |
| Missing information | No invented profile facts or premature roadmap; the next-step tool requests missing context. |
| AI API failure | Extraction failure and failure after a staged progress write both preserve the prior saved turn; a subsequent request recovers. |
| Concurrent workers | Two overlapping requests maintain separate profiles, histories, and plans; a mismatched sender cannot access the conversation. |

These automated tests verify service behavior with controlled model outputs; they do not evaluate natural-language quality. The opt-in live check uses the configured provider and six synthetic turns through Fastify's HTTP injection interface:

```bash
npm run test:journeys:live
```

It covers the eight non-failure scenarios, including simultaneous requests and service recreation. API failures are deliberately simulated in automated tests instead of causing real account or network failures. The live check prints synthetic messages/replies for human review and deletes its temporary memory afterward. It uses the existing API key and incurs provider charges. Existing shell environment values override `.env`; unset a stale provider key if needed.

No lint command is configured. TypeScript checks and the production build are separate checks. HTTP injection exercises routing and serialization but does not test a network listener, Photon delivery, or an actual iMessage session. Concurrent isolation is tested within the supported single-process deployment; multiple processes sharing a memory directory are not supported.

Milestone 7 validation: all 159 automated tests passed across 15 files; TypeScript checking and production build passed. All nine required journeys have automated service integration coverage. Six live Claude turns passed the eight non-failure scenarios, with replies manually reviewed for relevance, retained constraints, and unverified qualifications. A separate smoke check of the built app passed `/health` and `/api/chat` over an ephemeral loopback listener in mock mode. The sandbox initially blocked opening the listener; the approved local-only retry passed.

The first live journey run exposed an irrelevant progress clarification on a returning user's next-step question: Claude attempted a progress update based on an earlier report. Evidence validation prevented the write, but the reply was confusing. The update tool is now offered only when the latest message explicitly reports progress; a regression test verifies it is absent on next-step turns. The subsequent live run returned electrical fundamentals correctly after a restart. No Photon/iMessage delivery test has been performed, and live OpenAI journeys remain unverified.
