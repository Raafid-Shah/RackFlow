import { createApp, getLanUrls } from './app';
import { DEFAULT_DATA_DIR } from './lib/dataStore';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const app = createApp({ dataDir: DEFAULT_DATA_DIR });

app.listen(PORT, HOST, () => {
  const lanUrls = getLanUrls(PORT);
  console.log(`\nRackFlow LAN Server ready (offline-first)`);
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const url of lanUrls) {
    console.log(`  Shop WiFi: ${url}`);
  }
  console.log(`  Data dir: ${DEFAULT_DATA_DIR}\n`);
});