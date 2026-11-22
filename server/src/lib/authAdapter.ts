import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response } from 'express';

export interface OrgConfig {
  shopName: string;
  moderatorPin: string;
  showPinHint: boolean;
  staffPresets: string[];
}

export interface PublicOrgConfig {
  shopName: string;
  showPinHint: boolean;
  pinHint: string | null;
  staffPresets: string[];
}

const DEFAULT_ORG_CONFIG: OrgConfig = {
  shopName: 'Neighborhood Chemist',
  moderatorPin: '1234',
  showPinHint: true,
  staffPresets: ['Counter Staff', 'Floor Helper 1', 'Floor Helper 2'],
};

export function loadOrgConfig(dataDir: string): OrgConfig {
  const filePath = path.join(dataDir, 'org_config.json');
  if (!fs.existsSync(filePath)) return { ...DEFAULT_ORG_CONFIG };

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<OrgConfig>;
    const shopName =
      typeof raw.shopName === 'string' && raw.shopName.trim() !== ''
        ? raw.shopName.trim()
        : DEFAULT_ORG_CONFIG.shopName;
    const moderatorPin =
      typeof raw.moderatorPin === 'string' && raw.moderatorPin.trim() !== ''
        ? raw.moderatorPin.trim()
        : DEFAULT_ORG_CONFIG.moderatorPin;
    const showPinHint =
      typeof raw.showPinHint === 'boolean' ? raw.showPinHint : DEFAULT_ORG_CONFIG.showPinHint;
    const staffPresets =
      Array.isArray(raw.staffPresets) && raw.staffPresets.every((s) => typeof s === 'string')
        ? raw.staffPresets.map((s) => s.trim()).filter(Boolean)
        : DEFAULT_ORG_CONFIG.staffPresets;

    return { shopName, moderatorPin, showPinHint, staffPresets };
  } catch {
    return { ...DEFAULT_ORG_CONFIG };
  }
}

export function toPublicOrgConfig(cfg: OrgConfig): PublicOrgConfig {
  return {
    shopName: cfg.shopName,
    showPinHint: cfg.showPinHint,
    pinHint: cfg.showPinHint ? cfg.moderatorPin : null,
    staffPresets: cfg.staffPresets,
  };
}

export function readActorName(req: Request): string {
  const header = req.header('x-rackflow-staff')?.trim();
  return header && header.length > 0 ? header.slice(0, 60) : 'Counter Staff';
}

export function verifyModeratorPin(pin: string | undefined, dataDir: string): boolean {
  if (!pin) return false;
  const cfg = loadOrgConfig(dataDir);
  return pin.trim() === cfg.moderatorPin;
}

export function createModeratorGuard(dataDir: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pin = req.header('x-rackflow-pin');
    if (!verifyModeratorPin(pin, dataDir)) {
      res.status(401).json({
        error: 'Moderator PIN required for this action',
        code: 'UNAUTHORIZED_MODERATOR',
      });
      return;
    }
    next();
  };
}