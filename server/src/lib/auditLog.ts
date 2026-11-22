import fs from 'fs';
import path from 'path';

export type AuditAction =
  | 'FLAG_MISSING'
  | 'VERIFY_ITEM'
  | 'CREATE_ITEM'
  | 'UPDATE_ITEM'
  | 'MOVE_ITEM'
  | 'SWAP_CONTAINERS'
  | 'SHIFT_ROW'
  | 'UPDATE_LAYOUT'
  | 'CHANGE_PIN'
  | 'IMPORT_CSV'
  | 'UNDO_RESTORE';

export interface AuditEntry {
  timestamp: string;
  actor: string;
  role: 'staff' | 'moderator';
  action: AuditAction;
  summary: string;
  snapshot?: string | null;
  meta?: Record<string, unknown>;
}

export class AuditLog {
  readonly logPath: string;

  constructor(dataDir: string) {
    this.logPath = path.join(dataDir, 'audit_log.jsonl');
  }

  append(entry: Omit<AuditEntry, 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    fs.appendFileSync(this.logPath, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  readRecent(limit = 50): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs
      .readFileSync(this.logPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const out: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        out.push(JSON.parse(lines[i]) as AuditEntry);
      } catch {
        // Skip corrupt lines without failing the audit feed
      }
    }
    return out;
  }
}