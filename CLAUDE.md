# WhatsApp AI Agent — Sorting Out Programme

## Project Purpose

This is a WhatsApp AI Agent for the "Sorting Out" spiritual programme organised by Rev. Joe Olaiya and Living Faith Foundation. The agent is named **Elicia** and operates as a warm, empathetic guide that:

1. Onboards new users by collecting their name
2. Answers questions about the Sorting Out programme using a knowledge base loaded from Google Drive
3. Guides users toward programme registration
4. Escalates unanswerable questions to the support team via email
5. Persists all conversations and user data in MongoDB
6. Exposes an admin API for the dashboard to monitor conversations

---

## Tech Stack

- **Runtime**: Node.js (TypeScript via ts-node-dev)
- **Framework**: Express.js
- **Messaging**: Meta WhatsApp Cloud API
- **LLM**: Google Gemini (default) → Groq (fallback on failure)
- **Knowledge Base**: Google Drive (Docs, PDFs, Sheets, Slides) via Google Service Account
- **Database**: MongoDB via Mongoose
- **Email**: Nodemailer (SMTP / Gmail)
- **Auth (admin)**: Static API key via `x-admin-key` request header

---

## Folder Structure

```
whatsapp-agent/
├── src/
│   ├── index.ts                      # App entry point — Express setup, DB connect, server start
│   ├── config/
│   │   ├── env.ts                    # Loads & validates all environment variables
│   │   └── database.ts               # Mongoose connect helper
│   ├── models/
│   │   ├── User.ts                   # MongoDB User model (onboarding state, name, whatsappId)
│   │   ├── Conversation.ts           # MongoDB Conversation model (messages, escalations, status)
│   │   └── SupportTeam.ts            # MongoDB SupportTeam model (email recipients for escalation)
│   ├── routes/
│   │   ├── webhook.ts                # POST/GET /webhook — handles all incoming WhatsApp messages
│   │   └── admin.ts                  # /admin/* routes — protected dashboard API
│   └── services/
│       ├── sessionStore.ts           # In-memory LLM conversation history (last 20 turns per user)
│       ├── llm.ts                    # LLM calls via Gemini (default) with Groq fallback
│       ├── whatsapp.ts               # sendMessage() — posts messages to Meta Cloud API
│       ├── googleDrive.ts            # Loads & caches knowledge base from Google Drive folder
│       ├── testimonyService.ts       # Drive re-check + media delivery for testimony requests
│       ├── dateService.ts            # Detects a stale programme date, re-checks Drive, alerts team
│       ├── emailService.ts           # Sends escalation & stale-date emails to active SupportTeam members
│       └── conversationService.ts    # All MongoDB read/write helpers for Users & Conversations
├── SYSTEM_PROMPT.md                  # Elicia's personality, rules, and escalation instructions
├── KNOWLEDGE_BASE.md                 # Local file cache of Google Drive documents (auto-refreshed every 30 min)
├── service-account.json              # Google Service Account credentials (gitignored)
├── .env                              # All environment variables (gitignored)
├── .env.example                      # Template showing required variables
├── package.json
├── tsconfig.json
└── CLAUDE.md                         # This file
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | HTTP server port (default: 3000) |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token set in Meta App Dashboard |
| `WHATSAPP_ACCESS_TOKEN` | Meta permanent/temporary access token for sending messages |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number ID from Meta Business Suite |
| `GEMINI_API_KEY` | Google Gemini API key (default LLM) |
| `GEMINI_MODEL` | Gemini model name (default: `gemini-2.5-flash`) |
| `GROQ_API_KEY` | Groq API key (fallback LLM, used when Gemini fails) |
| `GROQ_MODEL` | Groq model name (default: `llama-3.3-70b-versatile`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to Google Service Account JSON file (local dev) — set this OR `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Raw Service Account JSON as a single-line string (hosted environments where a credentials file can't be committed) |
| `GOOGLE_DRIVE_FOLDER_ID` | Google Drive folder ID containing knowledge base documents |
| `MONGODB_URI` | MongoDB connection string (e.g. `mongodb+srv://...`) |
| `EMAIL_HOST` | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_PORT` | SMTP port (e.g. `587`) |
| `EMAIL_USER` | SMTP username / Gmail address |
| `EMAIL_PASS` | SMTP password or Gmail App Password |
| `EMAIL_FROM` | From name/address for outgoing emails |
| `ADMIN_API_KEY` | 32-char hex secret for admin API authentication |
| `ADMIN_DASHBOARD_URL` | CORS origin for the admin dashboard (default: `http://localhost:5173`) |

---

## Data Flow

```
WhatsApp user sends message
        │
        ▼
Meta Cloud API → POST /webhook
        │
        ▼
webhook.ts — parse message (from, text)
        │
        ▼
conversationService.getOrCreateUser(from)
        │
        ▼
conversationService.getActiveConversation(from)   ← MongoDB
        │  (creates new if none)
        ▼
ONBOARDING CHECK:
  onboardingState === 'collecting_name'?
  ├─ messages.length === 0  → send greeting, ask for name → RETURN
  └─ else                   → save name, set state 'active', send welcome menu → RETURN
        │
        ▼
ACTIVE FLOW:
  appendMessage(user message) → MongoDB
        │
        ▼
getKnowledgeBase()  ← KNOWLEDGE_BASE.md cache or Google Drive
        │
        ▼
chat(from, text, knowledgeBase)  ← Gemini LLM (Groq fallback)
        │
        ▼
Reply starts with [ESCALATE]?
  ├─ YES → strip tag, addEscalation(), updateStatus('inconclusive'),
  │         sendEscalationEmail() → Nodemailer → SupportTeam members
  └─ NO  → registration keyword detected? → updateStatus('conclusive')
        │
        ▼
appendMessage(assistant reply) → MongoDB
sendMessage(from, reply)       → Meta Cloud API → WhatsApp
```

---

## MongoDB Models

### User
| Field | Type | Description |
|---|---|---|
| `whatsappId` | String (unique, indexed) | The user's WhatsApp phone number |
| `name` | String (default: '') | Name collected during onboarding |
| `phoneNumber` | String | Same as whatsappId (set on insert) |
| `onboardingState` | Enum: `collecting_name` / `active` | Tracks whether name has been collected |
| `lastSeen` | Date | Updated on every message |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

### Conversation
| Field | Type | Description |
|---|---|---|
| `userId` | ObjectId (ref User) | Link to User document |
| `whatsappId` | String (indexed) | Denormalised for fast lookups |
| `status` | Enum: `pending` / `ongoing` / `inconclusive` / `conclusive` | Lifecycle state |
| `messages` | Array of `{role, content, timestamp}` | Full message history |
| `escalations` | Array of `{question, timestamp, emailSent}` | Escalation records |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

### SupportTeam
| Field | Type | Description |
|---|---|---|
| `email` | String (unique) | Email address for escalation emails |
| `name` | String | Display name |
| `active` | Boolean (default: true) | Whether this member receives escalation emails |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

---

## Conversation Status Lifecycle

```
[new conversation created]
        │
        ▼
     pending
        │
        ▼ (first active message processed)
     ongoing
        │
        ├──── user mentions registration ──────► conclusive
        │
        └──── LLM outputs [ESCALATE] signal ──► inconclusive
```

A new conversation is created when:
- There is no existing active conversation for the user, OR
- The previous conversation's status is `conclusive`

---

## [ESCALATE] Signal Mechanism

When the LLM cannot answer a question (e.g., specific dates, links, or testimonies not in the knowledge base), it is instructed via SYSTEM_PROMPT.md to output `[ESCALATE]` as the very first line of its reply.

The webhook handler:
1. Detects the `[ESCALATE]` prefix
2. Strips it from the reply before sending to user
3. Calls `addEscalation()` to log the question in MongoDB
4. Updates conversation status to `inconclusive`
5. Calls `sendEscalationEmail()` which emails all active SupportTeam members

The user sees only Elicia's warm reassurance — they are never told an email is being sent and never asked for their email.

---

## [TESTIMONY_SEARCH] Signal Mechanism

Testimonies (text, photos, or videos) can be added to the Google Drive 
folder after the knowledge base was last cached. When the LLM is asked 
for a testimony it can't find anywhere in the cached knowledge base, 
SYSTEM_PROMPT.md instructs it to output `[TESTIMONY_SEARCH]` as the 
first line of its reply (instead of `[ESCALATE]`), followed by a short 
holding message ("give me a second...").

The webhook handler:
1. Detects the `[TESTIMONY_SEARCH]` prefix, strips it, and immediately 
   sends the holding message to the user
2. Calls `testimonyService.findAndDeliverTestimony()`, which:
   - Force-refreshes the knowledge base from Drive, bypassing the 
     30-minute cache TTL (`googleDrive.refreshKnowledgeBase()`) — this 
     also re-saves `KNOWLEDGE_BASE.md`, so any new file is now part of 
     the cache
   - Parses the refreshed (and, as a fallback, the pre-refresh) 
     knowledge base for image/video files whose folder or filename 
     mentions "testimony" (`googleDrive.findTestimonyMedia()`), matched 
     against keywords from the user's message where possible
   - If a matching image/video is found: downloads the raw file from 
     Drive, uploads it to the WhatsApp Cloud API media store, and sends 
     it natively as an image/video message with a caption 
     (`whatsapp.uploadMedia()` + `whatsapp.sendMedia()`) — the file 
     itself is delivered, not just a link
   - If no media file matches (i.e. the testimony is text-only, or 
     still nothing was found): re-runs `chat()` against the refreshed 
     knowledge base so the LLM can answer with fresh text content, or 
     fall through to `[ESCALATE]` if genuinely nothing exists

Text-based testimonies already embedded in the knowledge base don't 
need this mechanism at all — the LLM quotes them directly per Rule 7 
in SYSTEM_PROMPT.md. `[TESTIMONY_SEARCH]` only fires when the cached 
knowledge base has nothing relevant.

---

## Stale Programme Date Handling

Whenever an incoming message matches `\b(date|dates|schedule|when is|when 
does|when's)\b` (word-boundary match, so "update"/"candidate" don't 
trigger it), `webhook.ts` calls `dateService.ensureFreshProgrammeDate()` 
before asking the LLM to reply:

1. Parses the `Date: ...` line out of the cached knowledge base (e.g. 
   "📅 Date: Friday, 12th – Sunday, 14th June 2026") into the last day 
   of the range and checks whether it's already passed
2. If it's still upcoming, nothing changes — the LLM answers normally
3. If it has passed (or no date could be parsed), it force-refreshes 
   the knowledge base from Google Drive (`googleDrive.refreshKnowledgeBase()`, 
   bypassing the 30-minute cache) — this also re-saves `KNOWLEDGE_BASE.md`
4. If the refreshed content has a new, upcoming date, that refreshed 
   knowledge base is used for the reply — the LLM shares the new date 
   directly, same as any other knowledge base fact
5. If Drive still has no upcoming date, it emails the support team 
   (`emailService.sendStaleDateAlert()`, throttled to once every 6 
   hours so repeat askers don't flood the team's inbox) and masks the 
   stale `Date:` line in the knowledge base passed to the LLM with an 
   explicit instruction not to repeat the outdated date and to 
   reassure the user the team has been notified — the conversation is 
   also marked `inconclusive` with an escalation record for the admin 
   dashboard

---

## Admin API Endpoints

All routes require the header: `x-admin-key: <ADMIN_API_KEY>`

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats` | Conversation counts: total, by status, today, this week |
| GET | `/admin/conversations` | Paginated list. Query: `page`, `limit`, `status` |
| GET | `/admin/conversations/:id` | Full conversation with all messages and escalations |
| PATCH | `/admin/conversations/:id/status` | Update status. Body: `{ status }` |
| GET | `/admin/users` | Paginated user list. Query: `page`, `limit` |
| GET | `/admin/support-team` | List all active support team members |
| POST | `/admin/support-team` | Add/reactivate member. Body: `{ email, name }` |
| DELETE | `/admin/support-team/:id` | Hard-delete a support team member |

---

## How to Run

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your values

# Start in development mode (hot reload)
npm run dev

# Build for production
npm run build
npm start
```

---

## Key Architecture Notes

- **Session store (`sessionStore.ts`)** is purely in-memory. It holds the last 20 message turns per WhatsApp number for LLM context. It resets on server restart. It is intentionally separate from MongoDB persistence.
- **MongoDB** is the source of truth for all user data, conversation history, and escalation records. It persists across restarts.
- **Knowledge base** is cached to `KNOWLEDGE_BASE.md` on disk with a 30-minute TTL. It is refreshed from Google Drive on startup and whenever the cache expires.
- **CORS** is configured to allow only the `ADMIN_DASHBOARD_URL` origin.
- **env.ts validation** throws on startup if any required variable is missing — this prevents silent misconfiguration.
