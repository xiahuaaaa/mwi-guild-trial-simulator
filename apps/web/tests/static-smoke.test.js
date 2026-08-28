import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
test('static shell exposes two bosses, plan tabs, import and unknown warning', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const text of ['试炼水母', '试炼刺猬', '均衡', '稳健', '冲层', '导入成员快照', 'unknown']) assert.match(html, new RegExp(text));
});
