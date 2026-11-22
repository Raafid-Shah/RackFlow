import { DataStore } from '../lib/dataStore';
import { buildSearchIndex, searchItems } from '../lib/searchEngine';
import { isMapped } from '../lib/spatialCues';

const store = new DataStore();
const data = store.load();
const mapped = data.items.filter(isMapped).length;
const withMrp = data.items.filter((i) => i.mrp_inr !== null).length;
const withTime = data.items.filter((i) => i.find_time_sec !== null).length;

console.log(`Data dir:      ${store.dataDir}`);
console.log(`Rows seen:     ${data.totalRows}`);
console.log(`Loaded items:  ${data.items.length} (mapped ${mapped}, unmapped ${data.items.length - mapped})`);
console.log(`Quarantined:   ${data.quarantined}`);
console.log(`Has MRP:       ${withMrp}   Has find time: ${withTime}`);
console.log(`Units:         ${data.layout.map((u) => `${u.unit_id}[${u.row_widths.join(',')}]`).join('  ') || '(none)'}`);
console.log(`Warnings:      ${data.warnings.length}`);

for (const w of data.warnings.slice(0, 50)) {
  console.log(`  [${w.severity}] line ${w.line} ${w.code}: ${w.message}`);
}

const index = buildSearchIndex(data.items);
const sample = data.items[0]?.brand_name ?? 'test';
const t0 = performance.now();
const hits = searchItems(index, sample);
console.log(`\nSample search "${sample}": ${hits.length} hit(s) in ${(performance.now() - t0).toFixed(2)} ms`);