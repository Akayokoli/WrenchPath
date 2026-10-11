import { TOOL_DEFINITIONS, TOOL_INSTRUCTIONS } from '../tools/definitions.js';
import OpenAI from 'openai';
import { assessmentInstructions } from '../conversation/prompt.js';
import { EXTRACTION_INSTRUCTIONS, extractionInput } from '../profiles/extract.js';
import { EXTRACTION_JSON_SCHEMA, extractionSchema } from '../profiles/schema.js';
import { intentSchema, turnResultSchema, type ConversationProvider } from '../conversation/types.js';

export function createOpenAIProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}): ConversationProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: options.fetch,
  });
  return {
    async extractProfile(messages) {
      const response = await client.responses.create({
        model: options.model, store: false, max_output_tokens: 4096,
        instructions: EXTRACTION_INSTRUCTIONS,
        input: [{ role: 'user', content: extractionInput(messages) }],
        text: { format: { type: 'json_schema', name: 'worker_profile', strict: true, schema: EXTRACTION_JSON_SCHEMA } },
      });
      if (response.status !== 'completed' || !response.output_text) throw new Error('Provider did not complete extraction');
      return extractionSchema.parse(JSON.parse(response.output_text));
    },
    async respond(messages, context, tools) {
      const input: OpenAI.Responses.ResponseInput = messages.map(({ role, content }) => ({ role, content }));
      let callCount = 0;
      const seen = new Set<string>();
      const usedTools = new Set<string>();
      for (let round = 0; round < 7; round++) {
        const response = await client.responses.create({
          model: options.model,
          instructions: assessmentInstructions(context) + (tools ? TOOL_INSTRUCTIONS : ''),
          input,
          ...(tools ? { tools: TOOL_DEFINITIONS.filter(t => !usedTools.has(t.name) && (t.name !== 'update_learning_progress' || tools.canUpdateProgress !== false)).map(t => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.schema, strict: true })), parallel_tool_calls: false } : {}),
          store: false,
          max_output_tokens: 1600,
          text: {
            format: {
              type: 'json_schema', name: 'wrenchpath_turn', strict: true,
              schema: {
                type: 'object', additionalProperties: false,
                properties: {
                  intent: { type: 'string', enum: intentSchema.options },
                  reply: { type: 'string' },
                },
                required: ['intent', 'reply'],
              },
            },
          },
        });
        const calls = response.output.filter(item => item.type === 'function_call');
        if (calls.length && tools && response.status === 'completed') {
          if ((callCount += calls.length) > 6) throw new Error('Tool call limit exceeded');
          for (const item of response.output) {
            if (item.type === 'function_call' || item.type === 'message' || item.type === 'reasoning') input.push(item);
            else throw new Error('Unexpected provider output item');
          }
          for (const call of calls) {
            if (seen.has(call.call_id)) throw new Error('Duplicate tool call');
            seen.add(call.call_id);
            if (usedTools.has(call.name)) throw new Error('Duplicate tool call');
            usedTools.add(call.name);
            if (call.name === 'update_learning_progress') usedTools.delete('get_next_milestone');
            let args: unknown;
            try { args = JSON.parse(call.arguments); } catch { args = null; }
            input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(tools.execute(call.name, args)) });
          }
          continue;
        }
        // Refusals, incomplete responses, malformed JSON, and invalid shapes fail closed.
        if (response.status !== 'completed' || !response.output_text) {
          throw new Error('Provider did not produce a completed response');
        }
        return turnResultSchema.parse(JSON.parse(response.output_text));
      }
      throw new Error('Tool round limit exceeded');
    },
  };
}
