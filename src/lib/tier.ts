/** Mirrors backend pricing.js storage bytes */
const TIER_STORAGE_LIMITS: Record<string, number | null> = {
  free: 50 * 1024 ** 3,
  lite: 50 * 1024 ** 3,
  pro: null,
  creator: null,
  premium: null,
  professional: null,
};

export function normalizeTierName(raw: string | null | undefined): string {
  const t = String(raw || "free").toLowerCase();
  if (t === "premium" || t === "professional") return "creator";
  return t || "free";
}

export function effectiveTierFromUser(user: Record<string, unknown> | null | undefined): string {
  if (!user) return "free";
  if (user.is_admin) return "creator";
  const eff = user.effective_tier ?? user.effectiveTier;
  if (eff) return normalizeTierName(String(eff));
  return normalizeTierName(
    String(user.subscription_tier ?? user.subscriptionTier ?? user.tier ?? "free")
  );
}

export function tierRank(tier: string): number {
  const t = normalizeTierName(tier);
  if (t === "creator") return 2;
  if (t === "pro") return 1;
  return 0;
}

export function bestTier(...tiers: Array<string | null | undefined>): string {
  let best = "free";
  for (const raw of tiers) {
    if (!raw) continue;
    const t = normalizeTierName(raw);
    if (tierRank(t) > tierRank(best)) best = t;
  }
  return best;
}

export function isPremiumTier(tier: string): boolean {
  const t = normalizeTierName(tier);
  return t === "pro" || t === "creator";
}

export function isCreatorTier(tier: string): boolean {
  return normalizeTierName(tier) === "creator";
}

/** Matches website EXPIRATION_DEFAULTS / MAX_EXPIRATION */
export function maxExpirationDays(tier: string): number | null {
  const t = normalizeTierName(tier);
  if (t === "free" || t === "lite") return 90;
  if (t === "basic") return 365;
  return null;
}

export function storageLimitForTier(tier: string): number | null {
  const t = normalizeTierName(tier);
  if (t === "pro" || t === "creator") return null;
  return TIER_STORAGE_LIMITS[t] ?? TIER_STORAGE_LIMITS.free;
}

export function tierDisplayName(tier: string): string {
  const t = normalizeTierName(tier);
  if (t === "creator") return "Creator";
  if (t === "pro") return "Pro";
  if (t === "lite") return "Lite";
  return "Free";
}
