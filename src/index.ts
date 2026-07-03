import { env } from './config/env';
import express from 'express';
import cors from 'cors';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import { getKnowledgeBase } from './services/googleDrive';
import { connectDB } from './config/database';

const app = express();

app.use(cors({ origin: env.ADMIN_DASHBOARD_URL }));
app.use(express.json());
app.use('/webhook', webhookRouter);
app.use('/admin', adminRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(Number(env.PORT), async () => {
  console.log(`Agent running on port ${env.PORT}`);

  try {
    await connectDB();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
  }

  try {
    await getKnowledgeBase();
    console.log('Knowledge base warmed up and ready');
  } catch (err) {
    console.error('Failed to load knowledge base on startup:', err);
  }
});
