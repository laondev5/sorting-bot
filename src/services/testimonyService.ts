import { refreshKnowledgeBase, findTestimonyMedia, downloadDriveFile } from './googleDrive';
import { uploadMedia, sendMedia } from './whatsapp';
import { chat } from './llm';

export interface TestimonyResult {
  mediaSent: boolean;
  reply: string;
}

// Called when the LLM couldn't find a testimony matching the user's
// request in the cached knowledge base. Gives Google Drive one more,
// uncached look — if a new testimony (text, image, or video) has been
// added since the last cache refresh, this picks it up, saves it to the
// knowledge base cache, and delivers it in whatever form it exists.
export async function findAndDeliverTestimony(
  to: string,
  userText: string,
  currentKnowledgeBase: string
): Promise<TestimonyResult> {
  let refreshedKnowledgeBase = currentKnowledgeBase;
  try {
    refreshedKnowledgeBase = await refreshKnowledgeBase();
  } catch (err) {
    console.error('[Testimony] Drive refresh failed, using cached knowledge base:', err);
  }

  const media =
    findTestimonyMedia(refreshedKnowledgeBase, userText) ??
    findTestimonyMedia(currentKnowledgeBase, userText);

  if (media) {
    try {
      const buffer = await downloadDriveFile(media.driveFileId);
      const mediaId = await uploadMedia(buffer, media.mimeType, media.name);
      const caption = `Here's a Sorting Out testimony for you 🙏\n${media.name.replace(/\.[^/.]+$/, '')}`;
      await sendMedia(to, mediaId, media.kind === 'video' ? 'video' : 'image', caption);
      console.log(`[Testimony] Sent ${media.kind}: ${media.name}`);
      return { mediaSent: true, reply: `[Testimony ${media.kind} sent: ${media.name}]` };
    } catch (err) {
      console.error(`[Testimony] Failed to deliver ${media.kind} "${media.name}", falling back to text:`, err);
    }
  }

  const reply = await chat(to, userText, refreshedKnowledgeBase);
  return { mediaSent: false, reply };
}
