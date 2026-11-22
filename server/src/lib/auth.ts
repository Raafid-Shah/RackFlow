import crypto from 'node:crypto';

export interface StoredPinConfig {
  moderatorPin?: string;
  moderatorPinHash?: string;
}

export interface SessionRecord {
  token: string;
  actor: string;
  createdAt: number;
  expiresAt: number;
}

interface FailureRecord {
  count: number;
  firstFailedAt: number;
  lockedUntil: number;
}

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;

const WEAK_PINS = new Set([
  '1234',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '654321',
  '000000',
  '111111',
  '999999',
  'password',
  'admin123',
]);

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function timingSafeStringMatch(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function verifyPinAgainstConfig(candidate: string, config: StoredPinConfig): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  if (typeof config.moderatorPinHash === 'string' && config.moderatorPinHash.startsWith('scrypt$')) {
    const parts = config.moderatorPinHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, storedHex] = parts;
    const storedBuf = Buffer.from(storedHex, 'hex');
    const candidateBuf = crypto.scryptSync(candidate, salt, storedBuf.length);
    return storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf);
  }

  if (typeof config.moderatorPin === 'string' && config.moderatorPin.length > 0) {
    return timingSafeStringMatch(candidate, config.moderatorPin);
  }

  return false;
}

export function validateNewPinStrength(newPin: string, currentPin: string): string | null {
  if (typeof newPin !== 'string') return 'New PIN must be text or digits.';
  const trimmed = newPin.trim();
  if (trimmed !== newPin) return 'PIN cannot start or end with spaces.';
  if (trimmed.length < 6 || trimmed.length > 24) {
    return 'New PIN must be between 6 and 24 characters.';
  }
  if (/^(.)\1+$/.test(trimmed)) {
    return 'New PIN cannot be the same character repeated.';
  }
  if (WEAK_PINS.has(trimmed.toLowerCase())) {
    return 'That PIN is too common. Choose a less predictable PIN.';
  }
  if (trimmed === currentPin) {
    return 'New PIN must be different from the current PIN.';
  }
  return null;
}

export class AuthManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly failures = new Map<string, FailureRecord>();

  checkLockout(ip: string, now = Date.now()): { locked: boolean; retryAfterSec: number } {
    const rec = this.failures.get(ip);
    if (!rec) return { locked: false, retryAfterSec: 0 };
    if (rec.lockedUntil > now) {
      return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    if (now - rec.firstFailedAt > FAILURE_WINDOW_MS) {
      this.failures.delete(ip);
    }
    return { locked: false, retryAfterSec: 0 };
  }

  recordFailure(ip: string, now = Date.now()): { locked: boolean; retryAfterSec: number; remaining: number } {
    const existing = this.failures.get(ip);
    let rec: FailureRecord;

    if (!existing || now - existing.firstFailedAt > FAILURE_WINDOW_MS) {
      rec = { count: 1, firstFailedAt: now, lockedUntil: 0 };
    } else {
      rec = { ...existing, count: existing.count + 1 };
    }

    if (rec.count >= MAX_FAILED_ATTEMPTS) {
      rec.lockedUntil = now + LOCKOUT_MS;
      this.failures.set(ip, rec);
      return { locked: true, retryAfterSec: Math.ceil(LOCKOUT_MS / 1000), remaining: 0 };
    }

    this.failures.set(ip, rec);
    return { locked: false, retryAfterSec: 0, remaining: MAX_FAILED_ATTEMPTS - rec.count };
  }

  clearFailures(ip: string): void {
    this.failures.delete(ip);
  }

  createSession(actor: string, now = Date.now()): SessionRecord {
    this.pruneExpired(now);
    const token = crypto.randomBytes(32).toString('hex');
    const session: SessionRecord = {
      token,
      actor,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(token, session);
    return session;
  }

  validateToken(token: string | undefined, now = Date.now()): SessionRecord | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revokeToken(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  revokeAllSessions(): void {
    this.sessions.clear();
  }

  activeSessionCount(now = Date.now()): number {
    this.pruneExpired(now);
    return this.sessions.size;
  }

  private pruneExpired(now: number): void {
    for (const [token, rec] of this.sessions.entries()) {
      if (rec.expiresAt <= now) this.sessions.delete(token);
    }
  }
}