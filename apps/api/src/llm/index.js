/**
 * LLM gateway public surface (Milestone 2, spec Section 8).
 *
 *   import { gateway, createGateway } from './llm/index.js';
 *   const res = await gateway.generate({ task: 'parse', prompt, schema });
 */
export { createGateway, gateway } from './gateway.js';
export { geminiAdapter } from './adapters/gemini.js';
export { groqAdapter } from './adapters/groq.js';
export { openrouterAdapter } from './adapters/openrouter.js';
export { ollamaAdapter } from './adapters/ollama.js';
export { mockForSchema, mockVector } from './mock.js';
export * from './errors.js';
