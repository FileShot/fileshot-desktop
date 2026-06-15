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

export function isPremiumTier(tier: string): boolean {
  const t = normalizeTierName(tier);
  return t === "pro" || t === "creator";
}

export function isCreatorTier(tier: string): boolean {
  return normalizeTierName(tier) === "creator";
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
