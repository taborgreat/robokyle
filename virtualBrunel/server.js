import http from 'node:http';
import { createBrunelHand } from './index.js';

// The real hand listens on 80; default to an unprivileged port here.
const port = Number(process.env.PORT) || 8080;
const { handle } = createBrunelHand({ storePath: 'data/eeprom.json' });

http.createServer(handle).listen(port, () => {
  console.log(`Virtual Brunel Hand   http://localhost:${port}/`);
  console.log(`API base URL          http://localhost:${port}/  (e.g. POST /gesture/execute)`);
});
