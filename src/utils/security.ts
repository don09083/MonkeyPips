/**
 * Security questions, cryptographic hashing, and strict input validation
 * synced verbatim with firebase-blueprint.json and firestore.rules.
 */

export const SECURITY_QUESTIONS: string[] = [
  "What was your first pet's name?",
  'In what city were you born?',
  'What was the name of your elementary school?',
  'What was your childhood nickname?',
  'What is the title of your favorite book?',
];

export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
export const HEX_64_REGEX = /^[a-f0-9]+$/;

export function normalizeUsernameId(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < 1) {
    return 'Username is required.';
  }
  if (trimmed.length > 32) {
    return 'Username must be 32 characters or fewer.';
  }
  if (!ID_REGEX.test(trimmed)) {
    return 'Username may only contain letters, numbers, underscores (_), and hyphens (-).';
  }
  return null;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateRoomCodeFormat(code: string): boolean {
  const normalized = normalizeRoomCode(code);
  return (
    normalized.length >= 4 &&
    normalized.length <= 32 &&
    ID_REGEX.test(normalized)
  );
}

/**
 * Generates a unique permanent room code (e.g., MC-7K9P2X) for a newly registered user.
 */
export function generateUniqueRoomCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let suffix = '';
  const randomValues = new Uint32Array(6);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[randomValues[i] % alphabet.length];
  }
  return `MC-${suffix}`;
}

/**
 * Generates a unique message document ID matching ^[a-zA-Z0-9_\-]+$ (max 64 chars).
 */
export function generateMessageId(): string {
  const randomValues = new Uint32Array(4);
  crypto.getRandomValues(randomValues);
  const hex = Array.from(randomValues)
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
  return `msg_${Date.now()}_${hex}`.slice(0, 64);
}

/**
 * Computes a 64-character lowercase SHA-256 hex digest using the Web Crypto API.
 */
export async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  return sha256Hex(`monkeychat_pw_v1:${password}`);
}

export async function hashSecurityAnswer(answer: string): Promise<string> {
  const normalized = answer.trim().toLowerCase().replace(/\s+/g, ' ');
  return sha256Hex(`monkeychat_sec_v1:${normalized}`);
}

/**
 * Computes a deterministic document ID for a display name to verify uniqueness in Firestore.
 * Matches ^[a-zA-Z0-9_\-]+$ and length <= 128 characters.
 */
export async function getDisplayNameDocId(displayName: string): Promise<string> {
  const normalized = displayName.trim().toLowerCase();
  const hash = await sha256Hex(`monkeychat_dn_v1:${normalized}`);
  return `dn_${hash.slice(0, 48)}`;
}

