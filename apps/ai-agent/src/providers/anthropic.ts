import { TOOL_DEFINITIONS, TOOL_INSTRUCTIONS } from '../tools/definitions.js';
import Anthropic from '@anthropic-ai/sdk';
import { assessmentInstructions } from '../conversation/prompt.js';
import { EXTRACTION_INSTRUCTIONS, extractionInput } from '../profiles/extract.js';
import { EXTRACTION_JSON_SCHEMA, extractionSchema } from '../profiles/schema.js';
import { intentSchema, turnResultSchema, type ConversationProvider } from '../conversation/types.js';

export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}): ConversationProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: options.fetch,
  });
  return {
    async extractProfile(messages) {
      const response = await client.messages.create({
        model: options.model, max_tokens: 4096,
        ...(options.model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' as const } } : {}),
        system: EXTRACTION_INSTRUCTIONS,
        messages: [{ role: 'user', content: extractionInput(messages) }],
        output_config: { format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA } },
      });
      if (response.stop_reason !== 'end_turn') throw new Error('Provider did not complete extraction');
      const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
      return extractionSchema.parse(JSON.parse(text));
    },
    async respond(messages, context, tools) {
      const input: Anthropic.Messages.MessageParam[] = messages.map(({ role, content }) => ({ role, content }));
      let callCount = 0;
      const seen = new Set<string>();
      const usedTools = new Set<string>();
      for (let round = 0; round < 7; round++) {
        const response = await client.messages.create({
          model: options.model,
          max_tokens: 1600,
          // Preserve the complete assistant turn, including thinking blocks, through tool calls.
          ...(options.model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' as const } } : {}),
          system: assessmentInstructions(context) + (tools ? TOOL_INSTRUCTIONS : ''),
          messages: input,
          ...(tools ? { tools: TOOL_DEFINITIONS.filter(t => !usedTools.has(t.name) && (t.name !== 'update_learning_progress' || tools.canUpdateProgress !== false)).map(t => ({ name: t.name, description: t.description, input_schema: t.schema })) } : {}),
          output_config: {
            format: {
              type: 'json_schema',
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
        if (response.stop_reason === 'tool_use' && tools) {
          const calls = response.content.filter(block => block.type === 'tool_use');
          if (!calls.length || (callCount += calls.length) > 6) throw new Error('Tool call limit exceeded');
          const results: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const call of calls) {
            if (seen.has(call.id)) throw new Error('Duplicate tool call');
            seen.add(call.id);
            if (usedTools.has(call.name)) throw new Error('Duplicate tool call');
            usedTools.add(call.name);
            if (call.name === 'update_learning_progress') usedTools.delete('get_next_milestone');
            results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(tools.execute(call.name, call.input)) });
          }
          input.push({ role: 'assistant', content: response.content }, { role: 'user', content: results });
          continue;
        }
        // Do not accept truncated or refused responses as finished replies.
        if (response.stop_reason === 'max_tokens') throw new Error('Response token limit exceeded');
        if (response.stop_reason !== 'end_turn') throw new Error('Provider did not complete the turn');
        const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
        return turnResultSchema.parse(JSON.parse(text));
      }
      throw new Error('Tool round limit exceeded');
    },
  };
}
