import { ProgressLevel } from '../types';

// ─── Tier promotion criteria (#359) ─────────────────────────────────────────────
//
// A player's tier (`progress_level`, 0–3) is derived purely from the number of
// `milestone_approved` events recorded for that player. A player is promoted to
// the highest tier whose minimum-milestone threshold their approved count meets
// or exceeds:
//
//   approved milestones │ tier │ meaning
//   ────────────────────┼──────┼──────────────────────────────────────
//   0                   │  0   │ Unverified (initial state at registration)
//   1–2                 │  1   │ Emerging
//   3–5                 │  2   │ Established
//   6 or more           │  3   │ Elite
//
// Thresholds are intentionally monotonic and data-driven (a single source of
// truth) so the indexer and the tests cannot drift apart. Tweak the numbers in
// TIER_THRESHOLDS to retune promotion; no other code needs to change.

export interface TierThreshold {
  tier: ProgressLevel;
  minApprovedMilestones: number;
}

/** Ordered highest-tier-first so the first match wins. */
export const TIER_THRESHOLDS: ReadonlyArray<TierThreshold> = [
  { tier: 3, minApprovedMilestones: 6 },
  { tier: 2, minApprovedMilestones: 3 },
  { tier: 1, minApprovedMilestones: 1 },
  { tier: 0, minApprovedMilestones: 0 },
];

/**
 * Returns the tier a player should hold given their total number of approved
 * milestones. Negative or fractional inputs are clamped to a non-negative
 * integer count. Always returns a valid ProgressLevel (0–3).
 */
export function tierForApprovedMilestones(approvedMilestones: number): ProgressLevel {
  const count = Math.max(0, Math.floor(approvedMilestones));
  for (const { tier, minApprovedMilestones } of TIER_THRESHOLDS) {
    if (count >= minApprovedMilestones) return tier;
  }
  return 0;
}
