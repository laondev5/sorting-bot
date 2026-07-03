import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  whatsappId: string;
  name: string;
  phoneNumber: string;
  onboardingState: 'collecting_name' | 'active';
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    whatsappId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    phoneNumber: { type: String, required: true },
    onboardingState: {
      type: String,
      enum: ['collecting_name', 'active'],
      default: 'collecting_name',
    },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
