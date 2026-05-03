import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WalkthroughConfig } from '@walkthrough/shared';

const DEFAULT_CONFIG: WalkthroughConfig = {
  port: 7773,
  poke: { kind: 'claude-resume' },
  editor: 'cursor',
  drawer: { position: 'right', size: 'standard', width: 504 },
  theme: 'auto',
  session: { retentionDays: 30 },
};

export async function loadConfig(configPath?: string): Promise<WalkthroughConfig> {
  const path = configPath ?? join(homedir(), '.claude', 'walkthrough', 'config.json');
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WalkthroughConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      poke: parsed.poke ?? DEFAULT_CONFIG.poke,
      drawer: { ...DEFAULT_CONFIG.drawer, ...(parsed.drawer ?? {}) },
      session: { ...DEFAULT_CONFIG.session, ...(parsed.session ?? {}) },
    };
  } catch (err) {
    console.error('failed to load config; using defaults', err);
    return DEFAULT_CONFIG;
  }
}

export { DEFAULT_CONFIG };
