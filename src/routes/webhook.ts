import { Router, Request, Response } from 'express';
import { chat } from '../services/llm';
import { sendMessage } from '../services/whatsapp';
import { getKnowledgeBase } from '../services/googleDrive';
import { findAndDeliverTestimony } from '../services/testimonyService';
import { ensureFreshProgrammeDate } from '../services/dateService';
import { env } from '../config/env';
import * as conversationService from '../services/conversationService';
import * as emailService from '../services/emailService';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

router.post('/', (req: Request, res: Response) => {
  res.status(200).send('OK');

  (async () => {
    try {
      const body = req.body;
      const entry = body?.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const messages = value?.messages;

      if (value?.statuses) return;
      if (!messages || messages.length === 0) return;

      const message = messages[0];
      if (message.type !== 'text') return;

      const from: string = message.from;
      const text: string = message.text.body;
      console.log(`[IN]  ${from}: ${text}`);

      // 1. Get or create user
      const user = await conversationService.getOrCreateUser(from);

      // 2. Get or create conversation
      let conversation = await conversationService.getActiveConversation(from);
      if (!conversation) {
        conversation = await conversationService.createConversation(
          user._id.toString(),
          from
        );
      }

      // 3. ONBOARDING
      if (user.onboardingState === 'collecting_name') {
        if (conversation.messages.length === 0) {
          // First ever message — greet and ask for name
          const greeting =
            "Hi there! Welcome!\n\nI'm Elicia, your guide to the Sorting Out programme.\n\nBefore we dive in, could I get your name please?";
          await conversationService.appendMessage(conversation._id.toString(), 'assistant', greeting);
          await sendMessage(from, greeting);
          console.log(`[OUT] ${from}: Asked for name`);
          return;
        } else {
          // User replied with their name
          const name = text.trim();
          await conversationService.setUserName(from, name);
          await conversationService.setOnboardingState(from, 'active');
          await conversationService.updateStatus(conversation._id.toString(), 'ongoing');
          await conversationService.appendMessage(conversation._id.toString(), 'user', text);

          const welcomeReply =
            `Thanks ${name}!\n\n` +
            `I'm so glad you reached out.\n\n` +
            `What would you like to know?\n\n` +
            `1. What is Sorting Out?\n` +
            `2. Who is it for?\n` +
            `3. What will I experience there?\n` +
            `4. How do I register?\n` +
            `5. I have a specific question`;

          await conversationService.appendMessage(conversation._id.toString(), 'assistant', welcomeReply);
          await sendMessage(from, welcomeReply);
          console.log(`[OUT] ${from}: ${welcomeReply.slice(0, 80)}...`);
          return;
        }
      }

      // 4. ACTIVE CONVERSATION
      if (conversation.status === 'pending') {
        await conversationService.updateStatus(conversation._id.toString(), 'ongoing');
      }

      // Detect registration intent → conclusive
      const registrationKeywords = [
        'register',
        'registration',
        'sign up',
        'signup',
        'how do i register',
        'want to register',
        'link to register',
        'i want to attend',
        'how to join',
      ];
      const isRegistrationIntent = registrationKeywords.some((kw) =>
        text.toLowerCase().includes(kw)
      );

      // Detect date intent (word-boundary match so "update"/"candidate" etc. don't trigger it)
      const isDateIntent = /\b(date|dates|schedule|when is|when does|when's)\b/i.test(text);

      // Append user message
      await conversationService.appendMessage(conversation._id.toString(), 'user', text);

      // Get AI reply
      let knowledgeBase = await getKnowledgeBase();
      let dateIsStale = false;

      if (isDateIntent) {
        const dateCheck = await ensureFreshProgrammeDate(knowledgeBase);
        knowledgeBase = dateCheck.knowledgeBase;
        dateIsStale = dateCheck.isStale;
      }

      let reply = await chat(from, text, knowledgeBase);
      let mediaAlreadySent = false;

      // Detect [TESTIMONY_SEARCH] signal — user asked for a testimony
      // that isn't in the cached knowledge base yet. Give Drive one more
      // look before falling back to escalation.
      if (reply.trimStart().startsWith('[TESTIMONY_SEARCH]')) {
        const holdingMessage = reply.replace(/^\s*\[TESTIMONY_SEARCH\]\s*/m, '').trim();
        if (holdingMessage) {
          await conversationService.appendMessage(conversation._id.toString(), 'assistant', holdingMessage);
          await sendMessage(from, holdingMessage);
        }

        const result = await findAndDeliverTestimony(from, text, knowledgeBase);
        reply = result.reply;
        mediaAlreadySent = result.mediaSent;
      }

      // Detect [ESCALATE] signal
      if (reply.trimStart().startsWith('[ESCALATE]')) {
        reply = reply.replace(/^\s*\[ESCALATE\]\s*/m, '').trim();
        await conversationService.addEscalation(conversation._id.toString(), text, true);
        await conversationService.updateStatus(conversation._id.toString(), 'inconclusive');
        try {
          await emailService.sendEscalationEmail(from, user.name || '', text);
          console.log(`[Escalation] Email sent for: "${text.slice(0, 60)}"`);
        } catch (e) {
          console.error('[Escalation] Email failed:', e);
        }
      } else if (dateIsStale) {
        await conversationService.addEscalation(conversation._id.toString(), text, true);
        await conversationService.updateStatus(conversation._id.toString(), 'inconclusive');
      } else if (isRegistrationIntent) {
        await conversationService.updateStatus(conversation._id.toString(), 'conclusive');
      }

      // Append assistant reply
      await conversationService.appendMessage(conversation._id.toString(), 'assistant', reply);

      if (!mediaAlreadySent) {
        await sendMessage(from, reply);
      }
      console.log(`[OUT] ${from}: ${reply.slice(0, 80)}...`);
    } catch (err) {
      console.error('Webhook handler error:', err);
    }
  })();
});

export default router;
