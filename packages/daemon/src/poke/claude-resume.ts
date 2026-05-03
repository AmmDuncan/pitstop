import { spawn as nodeSpawn } from 'node:child_process';
import type { Poke, PokeArgs, PokeResult } from './index';

type Opts = { spawn?: typeof nodeSpawn; command?: string };

export class ClaudeResumePoke implements Poke {
  constructor(private opts: Opts = {}) {}

  async trigger(args: PokeArgs): Promise<PokeResult> {
    if (!args.clientSessionId) {
      throw new Error('claude-resume requires clientSessionId');
    }
    const spawnFn = this.opts.spawn ?? nodeSpawn;
    const cmd = this.opts.command ?? 'claude';
    const argv = ['--resume', args.clientSessionId, '--print', args.context];
    const child = spawnFn(cmd, argv, { detached: true, stdio: 'ignore' });
    child.unref();
    const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
    return { pid: child.pid!, exited };
  }
}
