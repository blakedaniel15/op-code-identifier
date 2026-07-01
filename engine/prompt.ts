import type { Item, MenuItem } from './types';
import { dominantCluster } from './normalize';

export function buildSystemPrompt(catalog: MenuItem[], examples: { description: string; menuItemId: string }[]): string {
  const cat = catalog.map((m) => `${m.id} | ${m.name} | ${[...m.required, ...m.requiredAlso].join(', ')}`).join('\n');
  const ex = examples.map((e) => `"${e.description}" → ${e.menuItemId}`).join('\n');
  return [
    'You classify automotive dealership repair-order op codes into a fixed list of service menu items, or none.',
    '',
    'POLICY:',
    '- The operation DESCRIPTION is the primary signal (~80%). The op code is dealer-specific shorthand (~20%) — read it via the learned examples below.',
    '- A description that is a REPAIR or REPLACEMENT of a component (replace pump, rack, compressor, brake pads, hose) is NOT the fluid/service menu item. Prefer none.',
    '- Tire operations: return the tire menu item and the tire QUANTITY (1-4) when the count is present.',
    '- Labor-sale and tech-hours consistency is a SUPPORTING signal only: use it to LOWER confidence on a scattered code. NEVER raise confidence based on it.',
    '- Prefer null over a low-confidence guess. Use LOW confidence for a plausible-but-unsure match (it routes to human review).',
    '- Return menuItemId as an EXACT id from the catalog below, or null. Never invent an id.',
    '',
    'MENU ITEMS (id | name | keywords):',
    cat,
    ...(examples.length ? ['', 'EXAMPLES (confirmed by reviewers):', ex] : []),
  ].join('\n');
}

export function buildUserBatch(items: Item[]): string {
  const lines = items.map((it, i) => {
    const desc = dominantCluster(it.descriptions).raw || '(no description)';
    return `${i + 1}. op_code=${it.opCode} | description="${desc}" | rows=${it.rowCount}`;
  });
  return 'Classify each op-code line. Call the classify tool with one verdict per line, addressed by its 1-based index.\n\n' + lines.join('\n');
}
