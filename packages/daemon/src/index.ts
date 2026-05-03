import { buildApp } from './http/server';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.WALKTHROUGH_PORT ?? 7773);
const dataDir = join(homedir(), '.claude', 'walkthrough');

const app = buildApp({ port, dataDir });
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`walkthrough-daemon listening on http://localhost:${server.port}`);
