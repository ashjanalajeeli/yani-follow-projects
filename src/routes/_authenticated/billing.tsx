import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PLANS,
  formatUsd,
  priceInUsdCents,
  type BillingPeriod,
  type SubscriptionPlan,
} from "@/lib/subscription-plans";
import { validateReceiptFile } from "@/lib/file-validation";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "الاشتراكات — Yani" },
      { name: "description", content: "اختر خطة Yani واطلب اشتراكك بالدفع اليدوي." },
    ],
  }),
  component: BillingPage,
});

type Method = Tables<"payment_methods">;
type Request = Tables<"payment_requests">;
type Subscription = Tables<"user_subscriptions">;

function BillingPage() {
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<Exclude<SubscriptionPlan, "free"> | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [methodId, setMethodId] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [userNote, setUserNote] = useState("");
  const [busy, setBusy] = useState(false);

  const userQuery = useQuery({
    queryKey: ["billing-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error ?? new Error("يجب تسجيل الدخول أولًا.");
      return data.user;
    },
  });
  const user = userQuery.data;
  const subscriptionQuery = useQuery({
    queryKey: ["subscription", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Subscription | null;
    },
  });
  const methodsQuery = useQuery({
    queryKey: ["active-payment-methods"],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Method[];
    },
  });
  const requestsQuery = useQuery({
    queryKey: ["my-payment-requests", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Request[];
    },
  });
  const currentMonth = useMemo(
    () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`,
    [],
  );
  const usageQuery = useQuery({
    queryKey: ["ai-usage", user?.id, currentMonth],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_usage")
        .select("used_count")
        .eq("user_id", user!.id)
        .eq("usage_month", currentMonth)
        .maybeSingle();
      if (error) throw error;
      return data?.used_count ?? 0;
    },
  });

  const subscription = subscriptionQuery.data;
  const isExpired = Boolean(
    subscription &&
    (subscription.status !== "active" ||
      (subscription.ends_at && new Date(subscription.ends_at).getTime() <= Date.now())),
  );
  const currentPlan = isExpired ? "free" : (subscription?.plan ?? "free");
  const hasActivePaidPlan = currentPlan !== "free" && !isExpired;
  const activeMethods = methodsQuery.data ?? [];
  const selectedMethod = activeMethods.find((method) => method.id === methodId);
  const amount = selectedPlan ? priceInUsdCents(selectedPlan, period) : 0;

  async function submitPaymentRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !selectedPlan || !methodId || !receipt)
      return toast.error("اختر الخطة ووسيلة الدفع وأرفق الإيصال.");
    const invalid = validateReceiptFile(receipt);
    if (invalid) return toast.error(invalid);
    setBusy(true);
    let requestId: string | null = null;
    let storagePath: string | null = null;
    try {
      const { data, error } = await supabase.rpc("create_manual_payment_request", {
        _plan: selectedPlan,
        _billing_period: period,
        _payment_method_id: methodId,
        _user_note: userNote,
      });
      if (error || !data) throw error ?? new Error("تعذر إنشاء طلب الدفع.");
      requestId = data;
      const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "receipt";
      storagePath = `${user.id}/${requestId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("subscription-receipts")
        .upload(storagePath, receipt, {
          contentType:
            receipt.type ||
            (receipt.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const { error: attachError } = await supabase.rpc("attach_payment_receipt", {
        _request_id: requestId,
        _receipt_path: storagePath,
      });
      if (attachError) throw attachError;
      toast.success("استلمنا طلبك وإيصال الدفع. سيبقى الاشتراك بانتظار المراجعة اليدوية.");
      setSelectedPlan(null);
      setReceipt(null);
      setUserNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-payment-requests", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", user.id] }),
      ]);
    } catch (error) {
      if (storagePath) await supabase.storage.from("subscription-receipts").remove([storagePath]);
      if (requestId)
        await supabase.rpc("cancel_manual_payment_request", { _request_id: requestId });
      toast.error(error instanceof Error ? error.message : "تعذر إرسال طلب الدفع.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-8 p-5 md:p-8">
      <header>
        <p className="text-sm font-medium text-primary">خطط Yani</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">اختر الخطة المناسبة لك</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          الأسعار بالدولار الأمريكي. لا تشمل الأسعار أي ضريبة قد تنطبق؛ وتكون الضريبة، إن وجدت، على
          المشترك بالإضافة إلى السعر المعروض.
        </p>
      </header>

      <Card className="border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              خطتك الحالية: <span className="capitalize">{currentPlan}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              استخدام الذكاء الاصطناعي هذا الشهر: {usageQuery.data ?? 0} عملية. كل تحليل وإنشاء
              خارطة طريق كاملة يُحتسب عملية واحدة.
            </p>
          </div>
          {subscription?.ends_at && !isExpired && (
            <p className="text-sm text-muted-foreground">
              تنتهي في {new Date(subscription.ends_at).toLocaleDateString("ar")}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const current = currentPlan === plan.id;
          return (
            <Card
              key={plan.id}
              className={`flex flex-col p-5 ${plan.id === "pro" ? "border-primary shadow-md" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                </div>
                {current && (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    خطتك الحالية
                  </span>
                )}
              </div>
              <div className="mt-5">
                <p className="text-3xl font-bold">
                  {formatUsd(Math.round(plan.monthly * 100))}
                  <span className="text-sm font-normal text-muted-foreground"> / شهريًا</span>
                </p>
                {plan.id !== "free" && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    أو {formatUsd(Math.round(plan.annual * 100))} سنويًا — ما يعادل تقريبًا{" "}
                    {formatUsd(Math.round((plan.annual / 12) * 100))} شهريًا
                  </p>
                )}
                {plan.id === "free" && (
                  <p className="mt-1 text-sm text-muted-foreground">دائمًا مجانًا</p>
                )}
              </div>
              <ul className="my-5 flex-1 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.id === "free" ? (
                <Button variant="outline" disabled>
                  {current ? "الخطة الحالية" : "مجاني"}
                </Button>
              ) : (
                <Button
                  variant={current ? "outline" : "default"}
                  disabled={hasActivePaidPlan}
                  onClick={() => {
                    setSelectedPlan(plan.id);
                    setMethodId("");
                    setReceipt(null);
                  }}
                >
                  {current ? "اشتراكك فعال" : `اختيار ${plan.name}`}
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {selectedPlan && (
        <Card className="space-y-5 p-5 md:p-7">
          <div>
            <h2 className="text-xl font-semibold">
              طلب اشتراك {selectedPlan === "pro" ? "Pro" : "Premium"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              المبلغ الأساسي: {formatUsd(amount)}. قد تضاف الضريبة إن انطبقت، وسيتم التفعيل يدويًا
              بعد مطابقة الإيصال.
            </p>
          </div>
          <form onSubmit={submitPaymentRequest} className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">دورية الاشتراك</legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2">
                  <input
                    type="radio"
                    name="period"
                    checked={period === "monthly"}
                    onChange={() => setPeriod("monthly")}
                  />{" "}
                  شهري — {formatUsd(priceInUsdCents(selectedPlan, "monthly"))}
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2">
                  <input
                    type="radio"
                    name="period"
                    checked={period === "annual"}
                    onChange={() => setPeriod("annual")}
                  />{" "}
                  سنوي — {formatUsd(priceInUsdCents(selectedPlan, "annual"))}
                </label>
              </div>
            </fieldset>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="payment-method">وسيلة الدفع</Label>
                <select
                  id="payment-method"
                  value={methodId}
                  onChange={(event) => setMethodId(event.target.value)}
                  required
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">اختر الوسيلة</option>
                  {activeMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
                {selectedMethod && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6">
                    <p>
                      <strong>المستفيد:</strong> {selectedMethod.recipient_name}
                    </p>
                    <p className="break-all">
                      <strong>رقم الحساب/المحفظة:</strong> {selectedMethod.account_reference}
                    </p>
                    <p>
                      <strong>عملة الحساب:</strong> {selectedMethod.currency}
                    </p>
                    {selectedMethod.instructions && (
                      <p className="mt-1 whitespace-pre-wrap">{selectedMethod.instructions}</p>
                    )}
                  </div>
                )}
                {activeMethods.length === 0 && (
                  <p className="text-sm text-amber-700">
                    لا توجد وسيلة دفع مفعّلة حاليًا. سيضيف المشرف بيانات الحسابات من لوحة الإدارة.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt">إيصال التحويل أو الإيداع (صورة أو PDF، حتى 10 MB)</Label>
                <Input
                  id="receipt"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  الإيصال محفوظ في مخزن خاص، ولا يُفعّل الاشتراك بمجرد رفعه.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-note">ملاحظة للمشرف (اختياري)</Label>
              <Input
                id="payment-note"
                maxLength={500}
                value={userNote}
                onChange={(event) => setUserNote(event.target.value)}
                placeholder="رقم الحوالة أو تفاصيل إضافية"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || activeMethods.length === 0}>
                {busy ? "جارٍ إرسال الطلب…" : "إرسال طلب الدفع للمراجعة"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedPlan(null)}
                disabled={busy}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">طلبات الدفع السابقة</h2>
        {(requestsQuery.data ?? []).length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">لا توجد طلبات دفع حتى الآن.</Card>
        ) : (
          <div className="space-y-3">
            {(requestsQuery.data ?? []).map((request) => (
              <PaymentRequestCard
                key={request.id}
                request={request}
                methods={methodsQuery.data ?? []}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentRequestCard({ request, methods }: { request: Request; methods: Method[] }) {
  const method = methods.find((item) => item.id === request.payment_method_id);
  const state: Record<string, string> = {
    pending_receipt: "بانتظار الإيصال",
    pending_review: "بانتظار مراجعة المشرف",
    approved: "تمت الموافقة والتفعيل",
    rejected: "مرفوض — راجع الملاحظة",
    cancelled: "ملغي",
  };
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
      <div>
        <p className="font-semibold">
          {request.plan.toUpperCase()} — {request.billing_period === "annual" ? "سنوي" : "شهري"} —{" "}
          {formatUsd(request.amount_usd_cents)}
        </p>
        <p className="mt-1 text-muted-foreground">
          {method?.name ?? "وسيلة دفع"} · {new Date(request.created_at).toLocaleString("ar")}
        </p>
        {request.admin_note && (
          <p className="mt-2 text-amber-800">ملاحظة المشرف: {request.admin_note}</p>
        )}
      </div>
      <span className="rounded-full bg-muted px-3 py-1">
        {state[request.status] ?? request.status}
      </span>
    </Card>
  );
}
