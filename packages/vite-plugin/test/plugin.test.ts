import { test, expect } from 'bun:test';
import walkthrough from '../src/index';

test('plugin returns a Plugin object with the right name and apply mode', () => {
  const p = walkthrough();
  expect(p.name).toBe('@walkthrough/vite-plugin');
  expect(p.apply).toBe('serve');
});

test('alsoInProduction makes apply undefined (runs always)', () => {
  const p = walkthrough({ alsoInProduction: true });
  expect(p.apply).toBeUndefined();
});

test('transformIndexHtml emits two script tags pointing at the configured port', () => {
  const p = walkthrough({ port: 9000, projectRoot: '/tmp/myproject' });
  const handler = (p.transformIndexHtml as any).handler;
  const tags = handler('<html></html>', {
    server: { config: { root: '/tmp/myproject' } },
  });
  expect(Array.isArray(tags)).toBe(true);
  expect(tags).toHaveLength(2);
  expect(tags[0].tag).toBe('script');
  expect(tags[0].attrs.src).toBe('http://localhost:9000/inject.js?walkthrough-project=%2Ftmp%2Fmyproject');
  expect(tags[1].children).toContain('__WALKTHROUGH_PROJECT__');
  expect(tags[1].children).toContain('/tmp/myproject');
});

test('transformIndexHtml returns nothing during production builds (default)', () => {
  const p = walkthrough();
  const handler = (p.transformIndexHtml as any).handler;
  const result = handler('<html></html>', { bundle: { name: 'prod' } });
  expect(result).toBeUndefined();
});
