import { env } from '../../config/env.js';

/** OpenAI-compatible chat types (works with Groq, OpenAI, Ollama, OpenRouter, ...). */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  json?: boolean;
  temperature?: number;
}

export const llmEnabled = () => Boolean(env.LLM_API_KEY) || env.LLM_BASE_URL.includes('localhost');

export class LlmUnavailableError extends Error {}

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatMessage & { role: 'assistant' }> {
  if (!llmEnabled()) throw new LlmUnavailableError('No LLM configured (set LLM_API_KEY)');
  const res = await fetch(`${env.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.LLM_API_KEY ? { Authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: options.temperature ?? 0.3,
      ...(options.tools ? { tools: options.tools, tool_choice: 'auto' } : {}),
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }> };
  const msg = body.choices[0].message;
  return { role: 'assistant', content: msg.content, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) };
}

/** Asks for a JSON object and parses it, tolerating code fences some models add. */
export async function chatJson<T>(messages: ChatMessage[]): Promise<T> {
  const reply = await chat(messages, { json: true, temperature: 0.2 });
  const text = (reply.content ?? '{}').replace(/^```(?:json)?\s*|\s*```$/g, '');
  return JSON.parse(text) as T;
}
