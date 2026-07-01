import { AnthropicAdjudicator, type FetchLike } from './anthropicAdjudicator';
import type { Item } from './types';

const items: Item[] = [
  { dealerKey: 'd', opCode: 'A4', descriptions: [{ text: '4 WHEEL ALIGNMENT', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 },
  { dealerKey: 'd', opCode: 'ZZ', descriptions: [{ text: 'MYSTERY', count: 1 }], laborValues: [], hoursValues: [], rowCount: 1 },
];
const menuItemIds = new Set(['alignment', 'coolant']);
const mk = (fetchImpl: FetchLike) => new AnthropicAdjudicator({
  fetchImpl, apiKey: 'k', model: 'claude-sonnet-4-6', systemPrompt: 'SYS',
  menuItemIds, buildUserBatch: () => 'BATCH', delayMs: 0,
});
function respond(verdicts: unknown[]): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'classify', input: { verdicts } }] }) });
}

test('maps matched verdicts by 1-based index; unmatched/invalid → UNMATCHED', async () => {
  const out = await mk(respond([
    { index: 1, matched: true, menuItemId: 'alignment', confidence: 'HIGH', reason: 'ok' },
    { index: 2, matched: true, menuItemId: 'not_a_real_id', confidence: 'HIGH', reason: 'x' },
  ])).adjudicate(items);
  expect(out[0]!).toMatchObject({ menuItemId: 'alignment', matchType: 'AI', confidence: 'HIGH' });
  expect(out[1]!).toMatchObject({ menuItemId: null, matchType: 'UNMATCHED' });
});
test('a missing per-item verdict → UNMATCHED', async () => {
  const out = await mk(respond([{ index: 1, matched: true, menuItemId: 'alignment', confidence: 'MEDIUM', reason: 'ok' }])).adjudicate(items);
  expect(out[1]!.matchType).toBe('UNMATCHED');
});
test('matched:false → UNMATCHED', async () => {
  const out = await mk(respond([{ index: 1, matched: false, menuItemId: null, confidence: null, reason: 'no' }])).adjudicate([items[0]!]);
  expect(out[0]!.matchType).toBe('UNMATCHED');
});
test('fetch failing every attempt → whole batch UNMATCHED (no throw)', async () => {
  const out = await mk(async () => { throw new Error('network'); }).adjudicate(items);
  expect(out.map((v) => v.matchType)).toEqual(['UNMATCHED', 'UNMATCHED']);
});
test('request body carries cached system block + forced tool_choice', async () => {
  let body: any;
  const fetchImpl: FetchLike = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'classify', input: { verdicts: [] } }] }) };
  };
  await mk(fetchImpl).adjudicate([items[0]!]);
  expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(body.tool_choice).toEqual({ type: 'tool', name: 'classify' });
  expect(body.model).toBe('claude-sonnet-4-6');
});
