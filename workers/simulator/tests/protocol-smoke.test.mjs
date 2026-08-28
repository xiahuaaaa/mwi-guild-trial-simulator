import test from 'node:test';
import assert from 'node:assert/strict';

test('protocol source declares an explicit unknown-rules response', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/protocol.ts', import.meta.url), 'utf8');
  assert.match(source, /unknown-rules/);
  assert.match(source, /Boss 成长公式/);
});
