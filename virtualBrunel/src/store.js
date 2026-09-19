import fs from 'node:fs';
import path from 'node:path';

// Stands in for the Arduino's EEPROM: a JSON file that survives restarts.
// Without a file path it keeps everything in memory.
export function createStore(filePath) {
  let memory = {};

  return {
    load() {
      if (!filePath || !fs.existsSync(filePath)) return memory;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    },
    save(data) {
      memory = data;
      if (!filePath) return;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
  };
}
