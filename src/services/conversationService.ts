import User, { IUser } from '../models/User';
import Conversation, { IConversation } from '../models/Conversation';

export async function getOrCreateUser(whatsappId: string): Promise<IUser> {
  const user = await User.findOneAndUpdate(
    { whatsappId },
    {
      $set: { lastSeen: new Date() },
      $setOnInsert: { phoneNumber: whatsappId },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return user as IUser;
}

export async function getActiveConversation(
  whatsappId: string
): Promise<IConversation | null> {
  return Conversation.findOne({
    whatsappId,
    status: { $ne: 'conclusive' },
  }).sort({ createdAt: -1 });
}

export async function createConversation(
  userId: string,
  whatsappId: string
): Promise<IConversation> {
  return Conversation.create({ userId, whatsappId, status: 'pending' });
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await Conversation.findByIdAndUpdate(conversationId, {
    $push: { messages: { role, content, timestamp: new Date() } },
    $set: { updatedAt: new Date() },
  });
}

export async function updateStatus(
  conversationId: string,
  status: string
): Promise<void> {
  await Conversation.findByIdAndUpdate(conversationId, { $set: { status } });
}

export async function addEscalation(
  conversationId: string,
  question: string,
  emailSent: boolean
): Promise<void> {
  await Conversation.findByIdAndUpdate(conversationId, {
    $push: {
      escalations: { question, timestamp: new Date(), emailSent },
    },
  });
}

export async function setUserName(whatsappId: string, name: string): Promise<void> {
  await User.findOneAndUpdate({ whatsappId }, { $set: { name } });
}

export async function setOnboardingState(
  whatsappId: string,
  state: 'collecting_name' | 'active'
): Promise<void> {
  await User.findOneAndUpdate({ whatsappId }, { $set: { onboardingState: state } });
}
