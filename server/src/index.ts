import express from 'express';
import path from 'path';
import { THRESHOLDS } from './config/thresholds';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR, thresholds: THRESHOLDS });
});

app.listen(PORT, HOST, () => {
  console.log(`RackFlow scaffold server listening on http://${HOST}:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
});