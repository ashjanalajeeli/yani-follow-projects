import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/subscription-plans";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw redirect({ to: "/auth" });
    const { data: role, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (error || !role) throw redirect({ to: "/dashboard" });
  },
  head: () => ({ meta: [{ title: "إدارة الاشتراكات — Yani" }] }),
  component: AdminSubscriptions,
});

type Method = Tables<"payment_methods">;
type PaymentRequest = Tables<"payment_requests">;
type MethodDraft = Pick<
  Method,
  "recipient_name" | "account_reference" | "currency" | "instructions" | "active"
>;
type QueueRow = { request: PaymentRequest; methodName: string; receiptUrl: string | null };

function AdminSubscriptions() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, MethodDraft>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingMethod, setSavingMethod] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const methodsQuery = useQuery({
    queryKey: ["admin-payment-methods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as Method[];
    },
  });
  useEffect(() => {
    if (!methodsQuery.data) return;
    setDrafts(
      Object.fromEntries(
        methodsQuery.data.map((method) => [
          method.id,
          {
            recipient_name: method.recipient_name,
            account_reference: method.account_reference,
            currency: method.currency,
            instructions: method.instructions,
            active: method.active,
          },
        ]),
      ),
    );
  }, [methodsQuery.data]);

  const queueQuery = useQuery({
    queryKey: ["admin-payment-requests"],
    queryFn: async () => {
      const [{ data: requests, error: requestError }, { data: methods, error: methodError }] =
        await Promise.all([
          supabase.from("payment_requests").select("*").order("created_at", { ascending: false }),
          supabase.from("payment_methods").select("id,name"),
        ]);
      if (requestError) throw requestError;
      if (methodError) throw methodError;
      const methodMap = new Map((methods ?? []).map((method) => [method.id, method.name]));
      const rows: QueueRow[] = await Promise.all(
        (requests ?? []).map(async (request) => {
          let receiptUrl: string | null = null;
          if (request.receipt_path) {
            const { data } = await supabase.storage
              .from("subscription-receipts")
              .createSignedUrl(request.receipt_path, 300);
            receiptUrl = data?.signedUrl ?? null;
          }
          return {
            request,
            methodName: methodMap.get(request.payment_method_id) ?? "وسيلة دفع قديمة",
            receiptUrl,
          };
        }),
      );
      return rows;
    },
  });

  function changeDraft(id: string, patch: Partial<MethodDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function saveMethod(method: Method) {
    const draft = drafts[method.id];
    if (!draft) return;
    if (draft.active && (!draft.recipient_name.trim() || !draft.account_reference.trim())) {
      toast.error("أضف اسم المستفيد ورقم الحساب قبل تفعيل الوسيلة.");
      return;
    }
    setSavingMethod(method.id);
    const { error } = await supabase
      .from("payment_methods")
      .update({
        recipient_name: draft.recipient_name.trim(),
        account_reference: draft.account_reference.trim(),
        currency: draft.currency.trim().toUpperCase(),
        instructions: draft.instructions.trim(),
        active: draft.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", method.id);
    setSavingMethod(null);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ بيانات وسيلة الدفع.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-payment-methods"] }),
      queryClient.invalidateQueries({ queryKey: ["active-payment-methods"] }),
    ]);
  }

  async function reviewRequest(request: PaymentRequest, approve: boolean) {
    setReviewing(request.id);
    const { error } = await supabase.rpc("review_manual_payment_request", {
      _request_id: request.id,
      _approve: approve,
      _admin_note: notes[request.id] ?? "",
    });
    setReviewing(null);
    if (error) return toast.error(error.message);
    toast.success(approve ? "تم تفعيل الاشتراك بعد المراجعة." : "تم رفض الطلب.");
    await queryClient.invalidateQueries({ queryKey: ["admin-payment-requests"] });
  }

  const methods = methodsQuery.data ?? [];
  const rows = queueQuery.data ?? [];
  const pending = rows.filter(({ request }) => request.status === "pending_review");
  const history = rows.filter(({ request }) => request.status !== "pending_review");

  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-8 p-5 md:p-8">
      <header>
        <p className="text-sm font-medium text-primary">لوحة المشرف</p>
        <h1 className="mt-1 text-3xl font-bold">مراجعة الاشتراكات والمدفوعات</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          لا يتفعّل أي اشتراك تلقائيًا؛ طابق المبلغ والمستفيد والإيصال قبل الموافقة.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">وسائل الدفع والحسابات</h2>
          <p className="text-sm text-muted-foreground">
            أدخل بيانات الاستقبال الفعلية، ثم فعّل الوسيلة لتظهر للمشتركين. لا تضع كلمات مرور أو
            بيانات دخول هنا.
          </p>
        </div>
        {methods.map((method) => {
          const draft = drafts[method.id];
          if (!draft) return null;
          return (
            <Card key={method.id} className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{method.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {method.active ? "مفعّلة للمشتركين" : "غير مفعّلة"}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(event) => changeDraft(method.id, { active: event.target.checked })}
                  />{" "}
                  إظهار للمشتركين
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>اسم المستفيد</Label>
                  <Input
                    value={draft.recipient_name}
                    maxLength={160}
                    onChange={(event) =>
                      changeDraft(method.id, { recipient_name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>رقم الحساب / IBAN / المحفظة</Label>
                  <Input
                    value={draft.account_reference}
                    maxLength={200}
                    onChange={(event) =>
                      changeDraft(method.id, { account_reference: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>عملة الحساب</Label>
                  <Input
                    value={draft.currency}
                    maxLength={8}
                    onChange={(event) => changeDraft(method.id, { currency: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>تعليمات إضافية</Label>
                  <Input
                    value={draft.instructions}
                    maxLength={500}
                    onChange={(event) =>
                      changeDraft(method.id, { instructions: event.target.value })
                    }
                    placeholder="المدينة، الوكيل، أو تفاصيل الإيداع"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => saveMethod(method)}
                disabled={savingMethod === method.id}
              >
                {savingMethod === method.id ? "جارٍ الحفظ…" : "حفظ الوسيلة"}
              </Button>
            </Card>
          );
        })}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">طلبات بانتظار المراجعة</h2>
            <p className="text-sm text-muted-foreground">
              تحقق من الإيصال خارج النظام المصرفي؛ رفع صورة وحده لا يثبت وصول المال.
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
            {pending.length} طلب
          </span>
        </div>
        {pending.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">لا توجد طلبات بانتظار المراجعة.</Card>
        ) : (
          pending.map(({ request, methodName, receiptUrl }) => (
            <Card key={request.id} className="space-y-4 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">
                    {request.plan.toUpperCase()} ·{" "}
                    {request.billing_period === "annual" ? "سنوي" : "شهري"} ·{" "}
                    {formatUsd(request.amount_usd_cents)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.contact_email} · {methodName} ·{" "}
                    {new Date(request.created_at).toLocaleString("ar")}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    رقم الطلب: {request.id}
                  </p>
                  {request.user_note && (
                    <p className="mt-2 text-sm">ملاحظة العميل: {request.user_note}</p>
                  )}
                </div>
                {receiptUrl ? (
                  <a
                    href={receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border px-3 py-2 text-sm text-primary underline"
                  >
                    فتح الإيصال (رابط مؤقت)
                  </a>
                ) : (
                  <span className="text-sm text-destructive">تعذر إنشاء رابط الإيصال الخاص</span>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`admin-note-${request.id}`}>
                  ملاحظة للعميل (اختياري، تظهر عند الرفض)
                </Label>
                <Input
                  id={`admin-note-${request.id}`}
                  value={notes[request.id] ?? ""}
                  maxLength={1000}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => reviewRequest(request, true)}
                  disabled={reviewing === request.id || !receiptUrl}
                >
                  موافقة وتفعيل الخطة
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => reviewRequest(request, false)}
                  disabled={reviewing === request.id}
                >
                  رفض الطلب
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">سجل الطلبات</h2>
        {history.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">لا يوجد سجل سابق.</Card>
        ) : (
          history.map(({ request, methodName }) => (
            <Card
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
            >
              <div>
                <p className="font-medium">
                  {request.plan.toUpperCase()} ·{" "}
                  {request.billing_period === "annual" ? "سنوي" : "شهري"} ·{" "}
                  {formatUsd(request.amount_usd_cents)}
                </p>
                <p className="text-muted-foreground">
                  {request.contact_email} · {methodName} ·{" "}
                  {new Date(request.created_at).toLocaleString("ar")}
                </p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1">{request.status}</span>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
