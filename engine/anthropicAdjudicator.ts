import type { Adjudicator } from './adjudicator';
import type { Confidence, Item, Verdict } from './types';

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface AnthropicAdjudicatorDeps {
  fetchImpl: FetchLike;
  apiKey: string;
  model: string;
  systemPrompt: string;
  menuItemIds: Set<string>;
  buildUserBatch: (items: Item[]) => string;
  maxTokens?: number;
  maxRetries?: number;
  delayMs?: number;
  effort?: 'low' | 'medium' | 'high' | 'max';
}

const CLASSIFY_TOOL = {
  name: 'classify',
  description: 'Return one verdict per op-code line, addressed by its 1-based index.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            matched: { type: 'boolean' },
            menuItemId: { type: ['string', 'null'] },
            confidence: { type: ['string', 'null'], enum: ['HIGH', 'MEDIUM', 'LOW', null] },
            quantity: { type: ['integer', 'null'] },
            reason: { type: 'string' },
          },
          required: ['index', 'matched', 'menuItemId', 'confidence', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

function unmatched(reason: string): Verdict {
  return { menuItemId: null, matchType: 'UNMATCHED', confidence: 'LOW', reason };
}
function normConfidence(c: unknown): Confidence {
  return c === 'HIGH' || c === 'MEDIUM' || c === 'LOW' ? c : 'LOW';
}

export class AnthropicAdjudicator implements Adjudicator {
  constructor(private readonly deps: AnthropicAdjudicatorDeps) {}

  async adjudicate(items: Item[]): Promise<Verdict[]> {
    if (items.length === 0) return [];
    try {
      return this.map(items, await this.call(items));
    } catch {
      return items.map(() => unmatched('AI adjudication failed; defaulted to UNMATCHED.'));
    }
  }

  private async call(items: Item[]): Promise<any[]> {
    const body = {
      model: this.deps.model,
      max_tokens: this.deps.maxTokens ?? 4000,
      output_config: { effort: this.deps.effort ?? 'medium' },
      system: [{ type: 'text', text: this.deps.systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'classify' },
      messages: [{ role: 'user', content: this.deps.buildUserBatch(items) }],
    };
    const retries = this.deps.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await this.deps.fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': this.deps.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const data = await res.json();
        const block = (data.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === 'classify');
        if (!block || !Array.isArray(block.input?.verdicts)) throw new Error('no classify tool_use');
        return block.input.verdicts;
      } catch (e) {
        lastErr = e;
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, (this.deps.delayMs ?? 200) * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  private map(items: Item[], verdicts: any[]): Verdict[] {
    const byIndex = new Map<number, any>();
    for (const v of verdicts) if (typeof v?.index === 'number') byIndex.set(v.index, v);
    return items.map((_, i) => {
      const v = byIndex.get(i + 1);
      if (!v || v.matched !== true || typeof v.menuItemId !== 'string' || !this.deps.menuItemIds.has(v.menuItemId)) {
        return unmatched(typeof v?.reason === 'string' ? v.reason : 'No AI match.');
      }
      const verdict: Verdict = { menuItemId: v.menuItemId, matchType: 'AI', confidence: normConfidence(v.confidence), reason: typeof v.reason === 'string' ? v.reason : '' };
      if (typeof v.quantity === 'number' && v.quantity >= 1 && v.quantity <= 4) verdict.quantity = v.quantity;
      return verdict;
    });
  }
}
