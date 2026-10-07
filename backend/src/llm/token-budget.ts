import { Tiktoken } from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
const encoder = new Tiktoken(ranks);
/** Includes schemas and a framing allowance; Azure usage remains authoritative. */
export function estimateInput(messages: unknown, tools: unknown): number {
  return encoder.encode(JSON.stringify({ messages, tools }), [], []).length + 64;
}
