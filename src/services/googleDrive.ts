import { google } from 'googleapis';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const CACHE_TTL = 30 * 60 * 1000;
const KB_FILE_PATH = path.join(__dirname, '../../KNOWLEDGE_BASE.md');

let lastFetched = 0;

const auth = new google.auth.GoogleAuth(
  env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? {
        credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON),
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      }
    : {
        keyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      }
);

const drive = google.drive({ version: 'v3', auth });

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string | null;
}

async function fetchFilesInFolder(folderId: string, folderPath = 'Root'): Promise<string[]> {
  const docs: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink)',
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    const files = (res.data.files ?? []) as DriveFile[];
    console.log(`  [Drive] ${files.length} items found in "${folderPath}"`);

    for (const file of files) {
      if (!file.id || !file.name || !file.mimeType) continue;

      // Recurse into subfolders
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        console.log(`  [Drive] Entering subfolder: ${file.name}`);
        const subDocs = await fetchFilesInFolder(file.id, `${folderPath}/${file.name}`);
        docs.push(...subDocs);
        continue;
      }

      try {
        let content = '';

        if (file.mimeType === 'application/vnd.google-apps.document') {
          const r = await drive.files.export(
            { fileId: file.id, mimeType: 'text/plain' },
            { responseType: 'text' }
          );
          content = r.data as string;

        } else if (file.mimeType === 'text/plain' || file.mimeType === 'text/markdown') {
          const r = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'text' }
          );
          content = r.data as string;

        } else if (file.mimeType === 'application/pdf') {
          const r = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          );
          const buffer = Buffer.from(r.data as ArrayBuffer);
          const parsed = await pdfParse(buffer);
          content = parsed.text;

        } else if (
          file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.mimeType === 'application/msword'
        ) {
          const r = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          );
          const buffer = Buffer.from(r.data as ArrayBuffer);
          const result = await mammoth.extractRawText({ buffer });
          content = result.value;

        } else if (
          file.mimeType === 'application/vnd.google-apps.presentation' ||
          file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ) {
          try {
            const r = await drive.files.export(
              { fileId: file.id, mimeType: 'text/plain' },
              { responseType: 'text' }
            );
            content = r.data as string;
          } catch {
            content = `[Presentation: ${file.name}]\nLink: ${file.webViewLink ?? 'N/A'}`;
          }

        } else if (
          file.mimeType === 'application/vnd.google-apps.spreadsheet' ||
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ) {
          try {
            const r = await drive.files.export(
              { fileId: file.id, mimeType: 'text/csv' },
              { responseType: 'text' }
            );
            content = r.data as string;
          } catch {
            content = `[Spreadsheet: ${file.name}]\nLink: ${file.webViewLink ?? 'N/A'}`;
          }

        } else if (file.mimeType.startsWith('image/')) {
          content = `[Image: ${file.name}]\nType: ${file.mimeType}\nLink: ${file.webViewLink ?? 'N/A'}`;

        } else if (file.mimeType.startsWith('video/')) {
          content = `[Video: ${file.name}]\nType: ${file.mimeType}\nLink: ${file.webViewLink ?? 'N/A'}`;

        } else if (file.mimeType.startsWith('audio/')) {
          content = `[Audio: ${file.name}]\nType: ${file.mimeType}\nLink: ${file.webViewLink ?? 'N/A'}`;

        } else {
          console.log(`  [Drive] Skipping unsupported type: ${file.name} (${file.mimeType})`);
          continue;
        }

        if (!content.trim()) {
          console.log(`  [Drive] Skipping empty file: ${file.name}`);
          continue;
        }

        docs.push(`\n\n=== [${folderPath}] ${file.name} ===\n${content.trim()}`);
        console.log(`  [Drive] Loaded: ${file.name}`);

      } catch (err) {
        console.error(`  [Drive] Error reading "${file.name}":`, err);
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return docs;
}

async function fetchAndCache(): Promise<string> {
  console.log('Refreshing knowledge base from Google Drive...');
  console.log(`  Folder ID: ${env.GOOGLE_DRIVE_FOLDER_ID}`);

  const docs = await fetchFilesInFolder(env.GOOGLE_DRIVE_FOLDER_ID);

  const header =
    `# Knowledge Base\n` +
    `Last updated: ${new Date().toISOString()}\n` +
    `Documents loaded: ${docs.length}\n` +
    `---\n`;

  const content = header + docs.join('');

  fs.writeFileSync(KB_FILE_PATH, content, 'utf-8');
  lastFetched = Date.now();

  console.log(`Knowledge base saved to KNOWLEDGE_BASE.md — ${docs.length} documents`);
  return content;
}

export async function getKnowledgeBase(): Promise<string> {
  // Serve from the .md cache file if it is still fresh
  try {
    const stat = fs.statSync(KB_FILE_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age < CACHE_TTL) {
      const cached = fs.readFileSync(KB_FILE_PATH, 'utf-8');
      if (cached.trim()) {
        if (lastFetched === 0) {
          console.log('Knowledge base loaded from KNOWLEDGE_BASE.md cache');
        }
        lastFetched = stat.mtimeMs;
        return cached;
      }
    }
  } catch {
    // No cache file yet — fall through to fetch from Drive
  }

  return fetchAndCache();
}

// Bypasses the cache TTL entirely — used when a testimony request comes in
// that the cached knowledge base can't answer, so we give Drive one more
// look before escalating to a human.
export async function refreshKnowledgeBase(): Promise<string> {
  return fetchAndCache();
}

export interface TestimonyMedia {
  kind: 'image' | 'video' | 'audio';
  name: string;
  path: string;
  mimeType: string;
  driveFileId: string;
}

const MEDIA_BLOCK_RE =
  /=== \[(.+?)\] (.+?) ===\n\[(Image|Video|Audio): .+?\]\nType: (.+?)\nLink: (.+?)\n/g;

// The knowledge base only stores a text stub for image/video/audio files
// (see fetchFilesInFolder above). This re-derives the structured file list
// — including the Drive file ID, extracted from the webViewLink — so
// testimony media can be located and downloaded on demand.
export function parseMediaEntries(kbContent: string): TestimonyMedia[] {
  const entries: TestimonyMedia[] = [];
  const text = kbContent.endsWith('\n') ? kbContent : `${kbContent}\n`;
  MEDIA_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MEDIA_BLOCK_RE.exec(text)) !== null) {
    const [, path, name, kindLabel, mimeType, link] = match;
    const idMatch = link.match(/\/d\/([^/]+)/);
    if (!idMatch) continue;

    entries.push({
      kind: kindLabel.toLowerCase() as 'image' | 'video' | 'audio',
      name,
      path,
      mimeType: mimeType.trim(),
      driveFileId: idMatch[1],
    });
  }

  return entries;
}

// Looks for an image/video testimony file — a Drive file whose folder or
// name mentions "testimony" — optionally narrowed down by keywords from
// the user's request (e.g. a person's name or topic).
export function findTestimonyMedia(kbContent: string, query: string): TestimonyMedia | null {
  const candidates = parseMediaEntries(kbContent).filter(
    (m) => (m.kind === 'image' || m.kind === 'video') && /testimon/i.test(`${m.path} ${m.name}`)
  );
  if (candidates.length === 0) return null;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2 && t !== 'any');

  if (terms.length > 0) {
    const specific = candidates.find((m) => terms.some((t) => m.name.toLowerCase().includes(t)));
    if (specific) return specific;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}
