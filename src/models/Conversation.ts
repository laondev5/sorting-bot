import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IEscalation {
  question: string;
  timestamp: Date;
  emailSent: boolean;
}

export interface IConversation extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  whatsappId: string;
  status: 'pending' | 'ongoing' | 'inconclusive' | 'conclusive';
  messages: IMessage[];
  escalations: IEscalation[];
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const EscalationSchema = new Schema<IEscalation>(
  {
    question: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    emailSent: { type: Boolean, required: true },
  },
  { _id: false }
);

const ConversationSchema = new Schema<IConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    whatsappId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'ongoing', 'inconclusive', 'conclusive'],
      default: 'pending',
    },
    messages: { type: [MessageSchema], default: [] },
    escalations: { type: [EscalationSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
