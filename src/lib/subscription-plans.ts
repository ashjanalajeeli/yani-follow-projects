export type SubscriptionPlan = "free" | "pro" | "premium";
export type BillingPeriod = "monthly" | "annual";

export const PLAN_LIMITS: Record<
  SubscriptionPlan,
  { projects: number; aiPerMonth: number; fileBytes: number }
> = {
  free: { projects: 1, aiPerMonth: 3, fileBytes: 2 * 1024 * 1024 },
  pro: { projects: 5, aiPerMonth: 100, fileBytes: 10 * 1024 * 1024 },
  premium: { projects: 20, aiPerMonth: 500, fileBytes: 25 * 1024 * 1024 },
};

export const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    monthly: 0,
    annual: 0,
    tagline: "ابدأ مجانًا واكتشف قيمة Yani",
    features: [
      "مشروع نشط واحد",
      "إنشاء المهام والمراحل وتعديلها يدويًا",
      "لوحة متابعة تقدم المشروع",
      "3 عمليات ذكاء اصطناعي شهريًا",
      "رفع ملفات حتى 2 MB للملف",
    ],
  },
  {
    id: "pro" as const,
    name: "Pro",
    monthly: 6.99,
    annual: 59,
    tagline: "للمستقلين والطلاب والمشاريع الصغيرة",
    features: [
      "حتى 5 مشاريع نشطة",
      "100 عملية ذكاء اصطناعي شهريًا",
      "تحليل الأفكار وإنشاء المهام والمراحل تلقائيًا",
      "تحديد الأولويات والمخاطر",
      "رفع ملفات حتى 10 MB للملف وتحليل محتواها",
      "متابعة التقدم والتأخير",
      "تصدير ملخصات المشاريع (قريبًا)",
    ],
  },
  {
    id: "premium" as const,
    name: "Premium",
    monthly: 14.99,
    annual: 129,
    tagline: "للمحترفين الذين يديرون عدة مشاريع",
    features: [
      "حتى 20 مشروعًا نشطًا",
      "500 عملية ذكاء اصطناعي شهريًا",
      "رفع ملفات حتى 25 MB للملف وتحليلها",
      "لوحة لمتابعة عدة مشاريع معًا",
      "إعادة التخطيط والتحليل المتقدم للموارد والتكاليف والمخاطر (قريبًا)",
      "مقارنة السيناريوهات والتقارير الإدارية والقوالب الإضافية (قريبًا)",
    ],
  },
] as const;

export function priceInUsdCents(
  plan: Exclude<SubscriptionPlan, "free">,
  period: BillingPeriod,
): number {
  const selected = PLANS.find((item) => item.id === plan);
  if (!selected) throw new Error("Unknown subscription plan");
  return Math.round((period === "annual" ? selected.annual : selected.monthly) * 100);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
