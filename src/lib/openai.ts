// lib/openai.ts
import OpenAI from 'openai';

// ⚠️ Fix puntual: solo para llamadas que hace la SDK de OpenAI
const openaiFetch = (input: any, init: any = {}) => {
  if (init?.body && !init.duplex) init.duplex = 'half';
  return fetch(input, init);
};

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  fetch: openaiFetch,
});
