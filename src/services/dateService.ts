import { refreshKnowledgeBase } from './googleDrive';
import { sendStaleDateAlert } from './emailService';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Don't email the team more than once every 6 hours for the same stale
// date — otherwise every user who asks "when is the next one?" floods
// their inbox until someone updates the Drive document.
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastAlertSentAt = 0;

// Looks for the canonical "Date: ..." line in the "Sorting Out dates"
// document (e.g. "📅 Date: Friday, 12th – Sunday, 14th June 2026") and
// parses it into the last day of the range.
export function extractProgrammeDate(kbContent: string): Date | null {
  const dateLineMatch = kbContent.match(/Date:\s*([^\n]+)/i);
  if (!dateLineMatch) return null;
  return parseDateRangeEnd(dateLineMatch[1]);
}

function parseDateRangeEnd(text: string): Date | null {
  const monthMatch = text.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)/i
  );
  if (!monthMatch || monthMatch.index === undefined) return null;

  const monthIndex = MONTHS.indexOf(monthMatch[1].toLowerCase());
  const beforeMonth = text.slice(0, monthMatch.index);
  const afterMonth = text.slice(monthMatch.index + monthMatch[1].length);

  const yearMatch = afterMonth.match(/\d{4}/) ?? text.match(/\d{4}/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[0], 10);

  const days = [...beforeMonth.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((d) => d >= 1 && d <= 31);
  if (days.length === 0) return null;

  const lastDay = Math.max(...days);
  const date = new Date(year, monthIndex, lastDay, 23, 59, 59);
  return isNaN(date.getTime()) ? null : date;
}

export function isDatePast(date: Date): boolean {
  return date.getTime() < Date.now();
}

// Replaces the stale date line with an explicit note so the LLM doesn't
// quote the outdated date back to the user.
function maskStaleDate(kbContent: string): string {
  return kbContent.replace(
    /Date:\s*([^\n]+)/i,
    'Date: [OUTDATED — this date has already passed and a new date has not ' +
      'been confirmed yet. Do NOT share this old date with the user. Let ' +
      'them know the team has been notified and will confirm the next ' +
      'date shortly.]'
  );
}

export interface DateCheckResult {
  knowledgeBase: string;
  isStale: boolean;
}

// Called whenever a user asks about the programme date. If the date on
// file has already passed, gives Google Drive a fresh look (updating the
// cached knowledge base in the process). If Drive doesn't have a new
// date either, alerts the support team and masks the stale date so the
// LLM answers the user honestly instead of repeating outdated info.
export async function ensureFreshProgrammeDate(kbContent: string): Promise<DateCheckResult> {
  const currentDate = extractProgrammeDate(kbContent);
  if (currentDate && !isDatePast(currentDate)) {
    return { knowledgeBase: kbContent, isStale: false };
  }

  let refreshed = kbContent;
  try {
    refreshed = await refreshKnowledgeBase();
  } catch (err) {
    console.error('[DateCheck] Drive refresh failed:', err);
  }

  const refreshedDate = extractProgrammeDate(refreshed);
  if (refreshedDate && !isDatePast(refreshedDate)) {
    return { knowledgeBase: refreshed, isStale: false };
  }

  const now = Date.now();
  if (now - lastAlertSentAt > ALERT_COOLDOWN_MS) {
    lastAlertSentAt = now;
    const staleDateText = refreshed.match(/Date:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
    sendStaleDateAlert(staleDateText).catch((err) =>
      console.error('[DateCheck] Failed to send stale date alert:', err)
    );
  }

  return { knowledgeBase: maskStaleDate(refreshed), isStale: true };
}
