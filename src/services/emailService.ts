import nodemailer from 'nodemailer';
import { env } from '../config/env';
import SupportTeam from '../models/SupportTeam';

const transporter = nodemailer.createTransport({
  host: env.EMAIL_HOST,
  port: Number(env.EMAIL_PORT),
  secure: false,
  auth: {
    user: env.EMAIL_USER,
    pass: env.EMAIL_PASS,
  },
});

export async function sendEscalationEmail(
  whatsappId: string,
  userName: string,
  question: string
): Promise<void> {
  try {
    const members = await SupportTeam.find({ active: true }).lean();

    if (!members || members.length === 0) {
      console.log('[Email] No support team members configured');
      return;
    }

    const recipients = members.map((m) => m.email);
    const displayName = userName || 'Unknown';
    const subject = `Elicia needs help — unanswered question from ${userName || whatsappId}`;

    const html = `
<h2>A question needs a human answer</h2>
<p><strong>User:</strong> ${displayName}</p>
<p><strong>WhatsApp:</strong> ${whatsappId}</p>
<p><strong>Question:</strong></p>
<blockquote style="border-left:4px solid #ccc;padding:8px 16px;color:#555">${question}</blockquote>
<p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
<p style="color:#888;font-size:12px">Sent by Elicia — Sorting Out WhatsApp Agent</p>
`;

    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: recipients.join(', '),
      subject,
      html,
    });

    console.log(`[Email] Escalation sent to ${recipients.length} recipient(s)`);
  } catch (err) {
    console.error('[Email] Failed to send escalation email:', err);
  }
}

export async function sendStaleDateAlert(outdatedDateText: string | null): Promise<void> {
  try {
    const members = await SupportTeam.find({ active: true }).lean();

    if (!members || members.length === 0) {
      console.log('[Email] No support team members configured');
      return;
    }

    const recipients = members.map((m) => m.email);
    const subject = 'Elicia: the Sorting Out programme date needs updating';

    const html = `
<h2>The programme date on file has passed</h2>
<p>A user asked Elicia about the next Sorting Out date. She checked the
knowledge base and Google Drive but could not find an upcoming date.</p>
<p><strong>Last known date:</strong> ${outdatedDateText ?? 'None found'}</p>
<p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
<p>Please update the dates document in the Google Drive knowledge base
folder with the next confirmed date.</p>
<p style="color:#888;font-size:12px">Sent by Elicia — Sorting Out WhatsApp Agent</p>
`;

    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: recipients.join(', '),
      subject,
      html,
    });

    console.log(`[Email] Stale date alert sent to ${recipients.length} recipient(s)`);
  } catch (err) {
    console.error('[Email] Failed to send stale date alert:', err);
  }
}
