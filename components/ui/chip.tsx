import { cn } from '@/lib/ui';

export function matchTypeColor(mt: string): 'exact' | 'fuzzy' | 'ai' | 'unmatched' {
  return mt === 'EXACT' ? 'exact' : mt === 'RULE' ? 'fuzzy' : mt === 'AI' ? 'ai' : 'unmatched';
}

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset';
// Static class strings (so Tailwind's content scanner keeps them — never build these dynamically).
const COLOR: Record<'exact' | 'fuzzy' | 'ai' | 'unmatched', string> = {
  exact: 'bg-exact/10 text-exact ring-exact/20',
  fuzzy: 'bg-fuzzy/10 text-fuzzy ring-fuzzy/20',
  ai: 'bg-ai/10 text-ai ring-ai/20',
  unmatched: 'bg-unmatched/10 text-unmatched ring-unmatched/20',
};

export function MatchTypeChip({ matchType }: { matchType: string }) {
  return <span className={cn(CHIP, COLOR[matchTypeColor(matchType)])}>{matchType}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const inProg = status === 'in_progress';
  return (
    <span className={cn(CHIP, inProg ? COLOR.fuzzy : status === 'reviewed' ? COLOR.exact : COLOR.unmatched)}>
      {inProg ? 'In progress' : status === 'reviewed' ? 'Reviewed' : 'New'}
    </span>
  );
}
