import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { validateControlPreset } from './tools/controlDefaultPreset.ts';
import { validateGameSettings } from './src/game/gameSettingsSchema.ts';

const presetPath = fileURLToPath(new URL('./src/input/mobileControlDefaults.json', import.meta.url));
const gamePresetPath = fileURLToPath(new URL('./src/game/gameSettingsDefaults.json', import.meta.url));

function controlDefaultWriter(): Plugin {
  return {
    name: 'wall-ball-control-default-writer',
    apply: 'serve', // Never included in the production build.
    configureServer(server) {
      server.middlewares.use('/__dev/control-defaults', async (request, response) => {
        const reply = (status: number, message: string) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ message }));
        };
        if (request.method !== 'POST') { reply(405, 'POST required'); return; }
        const origin = request.headers.origin;
        try {
          if (!origin || new URL(origin).host !== request.headers.host) { reply(403, 'Same-origin request required'); return; }
        } catch { reply(403, 'Same-origin request required'); return; }
        if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, 'JSON required'); return; }
        try {
          let body = '';
          for await (const chunk of request) {
            body += chunk.toString();
            if (body.length > 16_384) { reply(413, 'Layout too large'); return; }
          }
          let parsed: unknown;
          try { parsed = JSON.parse(body); }
          catch { reply(400, 'Invalid JSON'); return; }
          const preset = validateControlPreset(parsed);
          if (!preset) { reply(400, 'Invalid control layout'); return; }
          await writeFile(presetPath, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
          reply(200, 'Saved as the code default');
        } catch {
          reply(500, 'Could not save the code default');
        }
      });
      server.middlewares.use('/__dev/game-defaults', async (request, response) => {
        const reply = (status: number, message: string) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ message }));
        };
        if (request.method !== 'POST') { reply(405, 'POST required'); return; }
        try {
          if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) {
            reply(403, 'Same-origin request required'); return;
          }
        } catch { reply(403, 'Same-origin request required'); return; }
        if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, 'JSON required'); return; }
        try {
          let body = '';
          for await (const chunk of request) {
            body += chunk.toString();
            if (body.length > 16_384) { reply(413, 'Settings too large'); return; }
          }
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { reply(400, 'Invalid JSON'); return; }
          const preset = validateGameSettings(parsed);
          if (!preset) { reply(400, 'Invalid game settings'); return; }
          await writeFile(gamePresetPath, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
          reply(200, 'Saved as the game default');
        } catch { reply(500, 'Could not save the game default'); }
      });
    },
  };
}

export default defineConfig({ plugins: [controlDefaultWriter()] });
