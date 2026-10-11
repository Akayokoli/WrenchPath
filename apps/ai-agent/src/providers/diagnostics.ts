// Only fixed descriptions leave this function. Never print raw SDK errors, headers, or bodies.
export function describeFailure(error: unknown): string {
  const value = error as { status?: number; name?: string; message?: string; code?: string } | null;
  const kind = error instanceof Error ? error.constructor.name : value?.name;
  const status = value?.status;
  const message = typeof value?.message === 'string' ? value.message.toLowerCase() : '';
  if (message === 'response token limit exceeded') return 'TOKEN_LIMIT: Provider exhausted its response token budget before finishing.';
  if (message === 'tool round limit exceeded' || message === 'tool call limit exceeded') return 'TOOL_LIMIT: Provider exceeded the bounded tool loop.';
  if (message === 'duplicate tool call') return 'DUPLICATE_TOOL: Provider repeated a tool call identifier.';
  if (kind === 'APIConnectionTimeoutError') return 'TIMEOUT: Provider exceeded AI_TIMEOUT_MS. Try a longer timeout.';
  if (kind === 'APIConnectionError') return 'CONNECTION: Cannot reach the provider. Check network access and proxy settings.';
  if (status === 401) return 'HTTP 401: Provider rejected the API credential. Check the selected provider and its API key.';
  if (status === 403) return 'HTTP 403: This account or key is not permitted to use the requested resource.';
  if (status === 404) return 'HTTP 404: Model or endpoint not found. Check AI_MODEL and account model access.';
  if (status === 402 || (status === 400 && /credit|billing|balance/.test(message))) return 'BILLING: Provider reports a credit or billing problem. Check the API account billing settings.';
  if (status === 429) return 'HTTP 429: Provider rate or quota limit reached. Check API limits and available credits.';
  if (status === 400) return 'HTTP 400: Provider rejected the request. Check model support for structured output and thinking settings.';
  if (typeof status === 'number' && status >= 500) return 'PROVIDER_UNAVAILABLE: Provider reported a server error. Try again later.';
  if (value?.name === 'ZodError' || value?.name === 'SyntaxError') return 'INVALID_OUTPUT: Model response or saved data failed JSON/schema validation.';
  if (['EACCES', 'ENOSPC', 'EROFS', 'EPERM'].includes(value?.code ?? '')) return 'STORAGE: Cannot read or write conversation storage. Check permissions and available disk space.';
  return 'INCOMPLETE_RESPONSE: No valid completed turn was available, or an unexpected local error occurred.';
}
