import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import {
  getHistory,
  appendHistory,
  isNewUser,
  clearHistory,
} from './sessionStore';

const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT_PATH = path.join(__dirname, '../../SYSTEM_PROMPT.md');

function loadSystemPrompt(): string {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  } catch {
    console.error(`Could not load SYSTEM_PROMPT.md from ${SYSTEM_PROMPT_PATH}`);
    throw new Error('SYSTEM_PROMPT.md is missing. Please create it at the project root.');
  }
}

// Load once at module init so every request pays zero I/O
const SYSTEM_PROMPT = loadSystemPrompt();

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND']);

type Message = { role: string; content: string };

async function callGemini(messages: Message[], model: string, attempt = 1): Promise<string> {
  const systemPrompt = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  try {
    const response = await axios.post(
      GEMINI_URL(model),
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        params: { key: env.GEMINI_API_KEY },
        timeout: 30000,
      }
    );
    const parts: Array<{ text?: string }> = response.data.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text ?? '').join('') || null;
    if (!content) throw new Error(`Gemini model ${model} returned empty content`);
    return content;
  } catch (err: unknown) {
    const axiosErr = err as { code?: string; response?: { status?: number } };
    if (attempt < 3 && axiosErr.code && RETRYABLE_CODES.has(axiosErr.code)) {
      const delay = attempt * 1500;
      console.log(`[Gemini] ${axiosErr.code} on ${model} — retry ${attempt}/2 in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return callGemini(messages, model, attempt + 1);
    }
    throw err;
  }
}

async function callGroq(messages: Message[], model: string, attempt = 1): Promise<string> {
  try {
    const response = await axios.post(
      GROQ_URL,
      { model, messages, max_tokens: 600, temperature: 0.2 },
      {
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const content: string | null = response.data.choices[0]?.message?.content ?? null;
    if (!content) throw new Error(`Groq model ${model} returned empty content`);
    return content;
  } catch (err: unknown) {
    const axiosErr = err as { code?: string; response?: { status?: number } };
    if (attempt < 3 && axiosErr.code && RETRYABLE_CODES.has(axiosErr.code)) {
      const delay = attempt * 1500;
      console.log(`[Groq] ${axiosErr.code} on ${model} — retry ${attempt}/2 in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return callGroq(messages, model, attempt + 1);
    }
    throw err;
  }
}

export async function chat(
  userId: string,
  userMessage: string,
  knowledgeBase: string
): Promise<string> {
  if (userMessage.trim().toLowerCase() === 'reset') {
    clearHistory(userId);
    return 'Conversation reset. How can I help you?';
  }

  try {
    const history = getHistory(userId);
    const firstTime = isNewUser(userId);

    const apiMessages: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (firstTime) {
      apiMessages.push({ role: 'user', content: `KNOWLEDGE BASE:\n${knowledgeBase}` });
      apiMessages.push({
        role: 'assistant',
        content:
          'Understood. I have read all the documents and will only answer based on them.',
      });
    }

    apiMessages.push(...(history as Message[]));
    apiMessages.push({ role: 'user', content: userMessage });

    let reply: string;

    try {
      reply = await callGemini(apiMessages, env.GEMINI_MODEL);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown } };
      console.error(
        `[Gemini] Primary model failed (HTTP ${axiosErr?.response?.status}):`,
        JSON.stringify(axiosErr?.response?.data ?? err, null, 2)
      );
      console.log('[LLM] Switching to Groq fallback...');
      reply = await callGroq(apiMessages, env.GROQ_MODEL);
    }

    appendHistory(userId, 'user', userMessage);
    appendHistory(userId, 'assistant', reply);

    return reply;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } };
    if (axiosErr?.response?.data) {
      console.error(
        `[LLM] Fatal error (HTTP ${axiosErr.response.status}):`,
        JSON.stringify(axiosErr.response.data, null, 2)
      );
    } else {
      console.error('[LLM] Fatal error:', err);
    }
    return "Sorry, I'm having trouble right now. Please try again shortly.";
  }
}
