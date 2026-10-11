# AI service handoff

The AI service is ready for teammate integration on `feature/ai-agent`. All implementation and documentation are inside `apps/ai-agent`. No shared contract or Photon backend files were changed. GitHub publication requires the supervising developer's approval.

## Start the demo

From the repository root, with Node.js 26 installed:

```bash
cd apps/ai-agent
npm ci
# Only on first setup; preserve an existing .env containing your key:
cp .env.example .env
```

Edit `.env` locally: set `AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5-5`, and your `ANTHROPIC_API_KEY`. Then:

```bash
npm run dev
```

The startup log should show `provider: anthropic`. If a stale exported key overrides `.env`, run `unset ANTHROPIC_API_KEY` in that terminal and restart. Do not share the key. For an offline contract check, use `AI_PROVIDER=mock`. For the built service, run `npm run build` followed by `npm start` from this directory.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | AI HTTP port. |
| `HOST` | `127.0.0.1` | Local-only listener; keep this for the same-machine demo. |
| `AI_PROVIDER` | `mock` | `anthropic`, `openai`, or static offline `mock`. |
| `AI_MODEL` | Provider-dependent | Claude: `claude-sonnet-5-5`; OpenAI: `gpt-5.6-terra`. Must be accessible to the selected account. |
| `ANTHROPIC_API_KEY` | Empty | Required for Claude only. |
| `OPENAI_API_KEY` | Empty | Required for OpenAI only. |
| `AI_TIMEOUT_MS` | `20000` | Per-provider-request timeout, not whole-turn timeout; allowed range 1000–120000. |
| `MEMORY_DIR` | `data/conversations` | Local JSON memory, relative to the process working directory. Run one service process per directory. |

## Photon integration

On the same machine, Photon backend calls `POST http://127.0.0.1:4000/api/chat` with `Content-Type: application/json`:

```json
{"conversationId":"demo-worker-1","senderId":"worker-1","message":"I do tires and oil changes. I want EV technician work."}
```

Success returns only `{"reply":"..."}`. Send that string to iMessage. Keep the same opaque IDs for the same worker's conversation; changing the conversation ID starts fresh. A different sender cannot reuse the saved conversation. IDs are ownership checks, not authentication; the service is for trusted local access.

Check HTTP status before using `reply`: malformed input uses 400, oversized bodies 413, unsupported content types 415, and unexpected route/service errors 500. Provider and storage failures retain the agreed HTTP 200 reply contract and return a safe retry message without saving a turn. The backend cannot treat HTTP 200 as proof of an AI answer.

A turn can make up to eight provider requests. With the default 20-second per-request timeout, allow more than 160 seconds plus local overhead if choosing a backend timeout (for example 180 seconds). Avoid automatic resending after an ambiguous network timeout: there is no request-id deduplication, so a retry could record the message twice. Delivery retries and user-facing waiting behavior need coordination with the Photon developer.

Quick connection check:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"demo-worker-1","senderId":"worker-1","message":"What is my next step?"}'
```

## Validation and remaining integration work

159 automated tests, TypeScript checking, and production build pass. Milestone 7 live Claude testing passed six synthetic HTTP-route turns covering concurrent workers, no certifications, weekend/budget constraints, persisted progress, return after restart, changed goals, and missing information. A separate built-app loopback smoke test passed in mock mode. No lint command is configured.

```bash
npm test
npm run typecheck
npm run build
# Optional paid live check, using temporary synthetic memory:
npm run test:journeys:live
```

Actual Photon/iMessage delivery and live OpenAI behavior remain untested. The next team integration task is one real message round trip through Photon, followed by a returning-worker message using the same IDs.

Memory is plaintext local JSON, ignored by Git, with a limit of 50 successful exchanges and no automatic expiry. Progress and credentials are user-reported, never verified. English evidence checks are conservative and may require clarification. Skills Passport has a local snapshot interface in `src/tools/passport.ts`; no external synchronization or teammate implementation is included.

Publication scope: `apps/ai-agent` source, tests, scripts, package/lock files, example environment, and documentation. `.env`, `data`, `node_modules`, and `dist` are ignored. A pattern scan found no recognized API-key, GitHub-token, AWS-key, or private-key signatures in publication candidates; this is not a guarantee against every possible secret format.
