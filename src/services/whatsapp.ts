import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env';

const CHUNK_SIZE = 4000;
const CHUNK_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendMessage(to: string, text: string): Promise<void> {
  try {
    if (text.length <= CHUNK_SIZE) {
      await postMessage(to, text);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      await postMessage(to, chunks[i]);
      if (i < chunks.length - 1) {
        await sleep(CHUNK_DELAY_MS);
      }
    }
  } catch (err) {
    console.error('WhatsApp send error:', err);
  }
}

async function postMessage(to: string, body: string): Promise<void> {
  await axios.post(
    `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// Uploads a file to Meta's Cloud API media store and returns the media ID
// needed to reference it in a subsequent image/video message.
export async function uploadMedia(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', buffer, { filename, contentType: mimeType });

  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        ...form.getHeaders(),
      },
    }
  );

  return response.data.id;
}

export async function sendMedia(
  to: string,
  mediaId: string,
  kind: 'image' | 'video',
  caption?: string
): Promise<void> {
  await axios.post(
    `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: kind,
      [kind]: { id: mediaId, ...(caption ? { caption } : {}) },
    },
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}
