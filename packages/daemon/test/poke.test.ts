import { test, expect, mock } from 'bun:test';
import { ClaudeResumePoke } from '../src/poke/claude-resume';

test('claude-resume builds the right argv', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = mock((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { unref: () => {}, pid: 12345, on: () => {} } as any;
  });
  const poke = new ClaudeResumePoke({ spawn: fakeSpawn as any });
  await poke.trigger({
    sessionId: 'abc',
    clientSessionId: 'cs-1',
    context: 'User commented on item 03: please tighten the layout.',
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.cmd).toBe('claude');
  expect(calls[0]!.args).toContain('--resume');
  expect(calls[0]!.args).toContain('cs-1');
  expect(calls[0]!.args).toContain('--print');
  expect(calls[0]!.args.at(-1)).toContain('item 03');
});

test('claude-resume throws when clientSessionId is missing', async () => {
  const poke = new ClaudeResumePoke({});
  await expect(
    poke.trigger({ sessionId: 'abc', clientSessionId: undefined as any, context: 'x' }),
  ).rejects.toThrow(/clientSessionId/);
});
