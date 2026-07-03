import dotenv from 'dotenv';
dotenv.config();

const required = [
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'GOOGLE_DRIVE_FOLDER_ID',
  'MONGODB_URI',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASS',
  'EMAIL_FROM',
  'ADMIN_API_KEY',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// Google service account credentials can come from a local file
// (GOOGLE_SERVICE_ACCOUNT_KEY_PATH, used in local dev) or from the raw
// JSON contents in an env var (GOOGLE_SERVICE_ACCOUNT_JSON, used on hosts
// where committing a credentials file isn't an option). Exactly one must
// be set.
if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    'Missing environment variable: set either GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON'
  );
}

export const env = {
  PORT: process.env.PORT ?? '3000',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN!,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN!,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  GROQ_API_KEY: process.env.GROQ_API_KEY!,
  GROQ_MODEL: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID!,
  MONGODB_URI: process.env.MONGODB_URI!,
  EMAIL_HOST: process.env.EMAIL_HOST!,
  EMAIL_PORT: process.env.EMAIL_PORT!,
  EMAIL_USER: process.env.EMAIL_USER!,
  EMAIL_PASS: process.env.EMAIL_PASS!,
  EMAIL_FROM: process.env.EMAIL_FROM!,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY!,
  ADMIN_DASHBOARD_URL: process.env.ADMIN_DASHBOARD_URL ?? 'http://localhost:5173',
};
