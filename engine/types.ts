export type MatchType = 'EXACT' | 'RULE' | 'AI' | 'UNMATCHED';
export type Confidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DescriptionCount { text: string; count: number; }

export interface Item {
  dealerKey: string;
  opCode: string;
  descriptions: DescriptionCount[];
  laborValues: number[];
  hoursValues: number[];
  rowCount: number;
}

export interface MenuItem {
  id: string;
  name: string;            // == business Service Name string
  required: string[];      // at least one must appear
  requiredAlso: string[];  // at least one must appear (empty = no second gate)
  disqualify: string[];    // none may appear
  isTire?: boolean;        // tire item carries a quantity
}

export interface StatsEffect {
  laborCv: number | null;
  hoursCv: number | null;
  effect: 'bumped' | 'capped' | 'none';
}

export interface Verdict {
  menuItemId: string | null;
  matchType: MatchType;
  confidence: Confidence;
  quantity?: number;
  reason: string;
  supportingStats?: StatsEffect;
}

export function itemKey(item: Pick<Item, 'dealerKey' | 'opCode'>): string {
  return `${item.dealerKey}::${item.opCode}`;
}
