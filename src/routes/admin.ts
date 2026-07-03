import { Router, RequestHandler } from 'express';
import { env } from '../config/env';
import Conversation from '../models/Conversation';
import User from '../models/User';
import SupportTeam from '../models/SupportTeam';

const router = Router();

const VALID_STATUSES = ['pending', 'ongoing', 'inconclusive', 'conclusive'] as const;

const adminAuth: RequestHandler = (req, res, next) => {
  if (req.headers['x-admin-key'] !== env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

router.use(adminAuth);

// GET /admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, pending, ongoing, inconclusive, conclusive, todayCount, thisWeekCount] =
      await Promise.all([
        Conversation.countDocuments(),
        Conversation.countDocuments({ status: 'pending' }),
        Conversation.countDocuments({ status: 'ongoing' }),
        Conversation.countDocuments({ status: 'inconclusive' }),
        Conversation.countDocuments({ status: 'conclusive' }),
        Conversation.countDocuments({ createdAt: { $gte: startOfToday } }),
        Conversation.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      ]);

    res.json({ total, pending, ongoing, inconclusive, conclusive, todayCount, thisWeekCount });
  } catch (err) {
    console.error('[Admin] /stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/conversations
router.get('/conversations', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.max(1, parseInt(req.query['limit'] as string) || 20);
    const status = req.query['status'] as string | undefined;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (status && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      filter['status'] = status;
    }

    const [rawConversations, total] = await Promise.all([
      Conversation.find(filter)
        .populate({ path: 'userId', select: 'name whatsappId phoneNumber' })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(filter),
    ]);

    const conversations = rawConversations.map((c) => {
      const messages = (c.messages as Array<{ role: string; content: string }>) ?? [];
      const lastMsg = messages[messages.length - 1];
      return {
        _id: c._id,
        user: c.userId,
        status: c.status,
        messageCount: messages.length,
        lastMessage: lastMsg ? lastMsg.content.slice(0, 100) : '',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });

    res.json({ conversations, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin] /conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/conversations/:id
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params['id'])
      .populate({ path: 'userId' })
      .lean();

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (err) {
    console.error('[Admin] /conversations/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /admin/conversations/:id/status
router.patch('/conversations/:id/status', async (req, res) => {
  try {
    const { status } = req.body as { status: string };

    if (!status || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
      return;
    }

    const conversation = await Conversation.findByIdAndUpdate(
      req.params['id'],
      { $set: { status } },
      { returnDocument: 'after' }
    );

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (err) {
    console.error('[Admin] PATCH /conversations/:id/status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/users
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.max(1, parseInt(req.query['limit'] as string) || 20);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(),
    ]);

    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin] /users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/support-team
router.get('/support-team', async (_req, res) => {
  try {
    const members = await SupportTeam.find({ active: true }).sort({ createdAt: -1 });
    res.json({ team: members });
  } catch (err) {
    console.error('[Admin] /support-team GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /admin/support-team
router.post('/support-team', async (req, res) => {
  try {
    const { email, name } = req.body as { email?: string; name?: string };

    if (!email || !name) {
      res.status(400).json({ error: 'Both email and name are required' });
      return;
    }

    const member = await SupportTeam.findOneAndUpdate(
      { email },
      { $set: { name, active: true } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    res.status(201).json({ member });
  } catch (err) {
    console.error('[Admin] /support-team POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /admin/support-team/:id
router.delete('/support-team/:id', async (req, res) => {
  try {
    await SupportTeam.findByIdAndDelete(req.params['id']);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] /support-team DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
