import { THRESHOLDS } from '../config/thresholds';
import { formatLocationCode, isMapped } from './spatialCues';
import { MedicineItem, SearchResult, SearchTier } from './types';

const EPS = 1e-9;
const FUZZY_CEILING = 0.84;

export interface SearchOptions {
  fuzzyThreshold?: number;
  maxResults?: number;
}

interface IndexEntry {
  item: MedicineItem;
  nameN: string;
  saltN: string;
  haystack: string;
  fuzzyTargets: string[];
  groupKey: string;
}

export interface SearchIndex {
  entries: IndexEntry[];
  groups: Map<string, IndexEntry[]>;
}

export function normalizeText(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function buildSearchIndex(items: readonly MedicineItem[]): SearchIndex {
  const entries: IndexEntry[] = [];
  const groups = new Map<string, IndexEntry[]>();

  for (const item of items) {
    const nameN = normalizeText(item.brand_name);
    const saltN = normalizeText(item.salt_compound);
    const haystack = [
      item.brand_name,
      item.salt_compound,
      item.strength_form,
      item.category,
      item.tags.join(' '),
    ]
      .map(normalizeText)
      .join(' ');

    const targets = new Set<string>();
    for (const text of [nameN, saltN]) {
      if (text.length >= 3) targets.add(text);
      for (const word of text.split(' ')) {
        if (word.length >= 3) targets.add(word);
      }
    }

    const entry: IndexEntry = {
      item,
      nameN,
      saltN,
      haystack,
      fuzzyTargets: [...targets],
      groupKey: `${nameN}|${normalizeText(item.strength_form)}`,
    };
    entries.push(entry);
    const g = groups.get(entry.groupKey);
    if (g) g.push(entry);
    else groups.set(entry.groupKey, [entry]);
  }
  return { entries, groups };
}

function statusRank(item: MedicineItem): number {
  return item.status === 'OK' ? 0 : item.status === 'UNASSIGNED' ? 1 : 2;
}

function chooseRepresentative(members: readonly IndexEntry[]): IndexEntry {
  return [...members].sort((a, b) => {
    const ma = isMapped(a.item) ? 0 : 1;
    const mb = isMapped(b.item) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    const sa = statusRank(a.item);
    const sb = statusRank(b.item);
    if (sa !== sb) return sa - sb;
    const va = a.item.last_verified ?? '';
    const vb = b.item.last_verified ?? '';
    if (va !== vb) return va < vb ? 1 : -1;
    return a.item.item_id < b.item.item_id ? -1 : a.item.item_id > b.item.item_id ? 1 : 0;
  })[0];
}

interface Hit {
  score: number;
  tier: SearchTier;
}

export function searchItems(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const q = normalizeText(query);
  if (q === '') return [];

  const fuzzyThreshold = options.fuzzyThreshold ?? THRESHOLDS.FUZZY_MATCH_THRESHOLD;
  const maxResults = Math.max(0, Math.floor(options.maxResults ?? THRESHOLDS.MAX_SEARCH_RESULTS));
  const hits = new Map<string, Hit>();

  const consider = (key: string, score: number, tier: SearchTier): void => {
    const cur = hits.get(key);
    if (!cur || score > cur.score) hits.set(key, { score, tier });
  };

  const tokens = q.split(' ');
  const qPad = ` ${q}`;

  for (const e of index.entries) {
    if (` ${e.nameN}`.includes(qPad) || ` ${e.saltN}`.includes(qPad)) {
      consider(e.groupKey, 1.0, 1);
    } else if (tokens.every((t) => e.haystack.includes(t))) {
      consider(e.groupKey, 0.85, 2);
    }
  }

  if (hits.size < 3 && q.length >= 3) {
    for (const e of index.entries) {
      if (hits.has(e.groupKey)) continue;
      let best = 0;
      for (const target of e.fuzzyTargets) {
        const max = Math.max(q.length, target.length);
        if (1 - Math.abs(q.length - target.length) / max < fuzzyThreshold - EPS) continue;
        const sim = similarity(q, target);
        if (sim > best) best = sim;
      }
      if (best >= fuzzyThreshold - EPS && (best > 0 || fuzzyThreshold <= 0)) {
        consider(e.groupKey, Math.min(best, FUZZY_CEILING), 3);
      }
    }
  }

  const results: SearchResult[] = [];
  for (const [key, hit] of hits) {
    const members = index.groups.get(key);
    if (!members || members.length === 0) continue;
    const rep = chooseRepresentative(members);
    const repCode =
      isMapped(rep.item) && rep.item.row !== null && rep.item.col !== null
        ? formatLocationCode(rep.item.unit_id, rep.item.row, rep.item.col)
        : null;

    const also: string[] = [];
    if (repCode !== null) {
      for (const m of members) {
        if (m === rep || !isMapped(m.item) || m.item.row === null || m.item.col === null) continue;
        const code = formatLocationCode(m.item.unit_id, m.item.row, m.item.col);
        if (code !== repCode && !also.includes(code)) also.push(code);
      }
    }

    results.push({
      item: rep.item,
      score: hit.score,
      tier: hit.tier,
      isApproximate: hit.tier === 3,
      alsoStoredAt: also,
    });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.tier - b.tier ||
      a.item.brand_name.localeCompare(b.item.brand_name) ||
      a.item.item_id.localeCompare(b.item.item_id),
  );
  return results.slice(0, maxResults);
}