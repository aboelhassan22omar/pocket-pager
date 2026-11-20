// Pocket Pager prices, per branch per month, in Egyptian pounds. One file for the server (what
// a subscription costs) and the pages (the calculator), so the two never disagree.
//
// Volume pricing: the more branches, the less each one costs, down to 1,500 at 100 branches and
// never below. Adding a branch never lowers the bill: a count just under a tier pays at most
// what the tier's first count pays (for example 95 branches never pay more than 100 would).

export const CURRENCY = 'ج.م';
export const FLOOR_PRICE = 1500;
export const MAX_BRANCHES = 500;
export const MONTH_OPTIONS = [1, 3, 6, 12];

/** [from branches, price per branch per month], ascending. */
export const TIERS = [
  [1, 2500],
  [2, 2300],
  [5, 2150],
  [10, 2000],
  [25, 1850],
  [50, 1700],
  [75, 1600],
  [100, 1500],
];

/** The tier price for `count` branches. */
export function tierPrice(count) {
  let price = TIERS[0][1];
  for (const [from, p] of TIERS) if (count >= from) price = p;
  return Math.max(price, FLOOR_PRICE);
}

/** What `count` branches cost per month, after the "never more than the next tier" rule. */
export function monthlyTotal(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return 0;
  let total = n * tierPrice(n);
  for (const [from, price] of TIERS) if (from > n) total = Math.min(total, from * price);
  return total;
}

/**
 * The full quote: per-branch price (rounded down to a pound), the monthly total, and the total
 * for `months`. `next`: the next tier, to show "from N branches the branch is X".
 */
export function quote(count, months = 1) {
  const n = Math.min(MAX_BRANCHES, Math.max(1, Math.floor(Number(count)) || 1));
  const m = MONTH_OPTIONS.includes(Number(months)) ? Number(months) : 1;
  const monthly = monthlyTotal(n);
  const next = TIERS.find(([from]) => from > n);
  return {
    branches: n,
    months: m,
    perBranch: Math.floor(monthly / n),
    monthly,
    total: monthly * m,
    next: next ? { from: next[0], price: next[1] } : null,
  };
}

/** 12500 -> "12,500" (Latin digits, like the rest of the numbers on our pages). */
export const money = (n) => Number(n).toLocaleString('en-US');
