import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportTeam extends Document {
  email: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTeamSchema = new Schema<ISupportTeam>(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISupportTeam>('SupportTeam', SupportTeamSchema);
