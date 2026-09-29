import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { validateControlPreset } from './tools/controlDefaultPreset.ts';
import { validateGameSettings } from './src/game/gameSettingsSchema.ts';
import { validateArenaDefinition } from './src/game/arena.ts';
import { validateMapDocument } from './src/maps/mapLibrary.ts';

const presetPath = fileURLToPath(new URL('./src/input/mobileControlDefaults.json', import.meta.url));
const gamePresetPath = fileURLToPath(new URL('./src/game/gameSettingsDefaults.json', import.meta.url));
const arenaPresetPath = fileURLToPath(new URL('./src/maps/classic.json', import.meta.url));
const mapsDirectory = fileURLToPath(new URL('./src/maps/', import.meta.url));

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
      server.middlewares.use('/__dev/arena-defaults', async (request, response) => {
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
            if (body.length > 131_072) { reply(413, 'Arena too large'); return; }
          }
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { reply(400, 'Invalid JSON'); return; }
          const preset = validateArenaDefinition(parsed);
          if (!preset) { reply(400, 'Invalid arena layout'); return; }
          await writeFile(arenaPresetPath, `${JSON.stringify({ id: 'classic', name: 'Classic Arena', schemaVersion: 1, arena: preset }, null, 2)}\n`, 'utf8');
          reply(200, 'Saved as the default arena');
        } catch { reply(500, 'Could not save the default arena'); }
      });
      server.middlewares.use('/__dev/maps', async (request, response) => {
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
            if (body.length > 131_072) { reply(413, 'Map too large'); return; }
          }
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { reply(400, 'Invalid JSON'); return; }
          if (!parsed || typeof parsed !== 'object') { reply(400, 'Invalid map request'); return; }
          const mode = (parsed as { mode?: unknown }).mode;
          const map = validateMapDocument((parsed as { map?: unknown }).map);
          if (!map || (mode !== 'new' && mode !== 'update')) { reply(400, 'Invalid map definition'); return; }
          const path = `${mapsDirectory}${map.id}.json`;
          if (mode === 'update') {
            let existing: unknown;
            try { existing = JSON.parse(await readFile(path, 'utf8')); }
            catch { reply(404, 'Built-in map does not exist'); return; }
            if (!validateMapDocument(existing)) { reply(409, 'Existing built-in map is invalid'); return; }
          }
          try { await writeFile(path, `${JSON.stringify(map, null, 2)}\n`, { encoding: 'utf8', flag: mode === 'new' ? 'wx' : 'w' }); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') { reply(409, 'Map ID already exists'); return; }
            throw error;
          }
          reply(200, mode === 'new' ? 'Built-in map created' : 'Built-in map updated');
        } catch { reply(500, 'Could not save built-in map'); }
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/wall-ball-reborn/' : '/',
  plugins: [controlDefaultWriter()],
}));
