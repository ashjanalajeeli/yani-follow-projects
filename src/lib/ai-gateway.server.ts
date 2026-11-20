// Server-only helper for calling the Lovable AI Gateway.
// Uses raw fetch to /v1/chat/completions for simplicity and reliability.

const BASE = "https://ai.gateway.lovable.dev/v1";
const GATEWAY_TIMEOUT_MS = 90_000;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface GatewayOptions {
  model?: string;
  temperature?: number;
  responseFormat?: "json_object" | "text";
}

export async function callGateway(
  messages: ChatMessage[],
  opts: GatewayOptions = {},
): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const body: Record<string, unknown> = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages,
  };
  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[ai-gateway] request failed", err);
    throw new Error("تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.");
  }

  if (!res.ok) {
    // Log upstream details server-side only; never echo them to the client.
    const text = await res.text().catch(() => "");
    console.error(`[ai-gateway] ${res.status}: ${text.slice(0, 1000)}`);
    if (res.status === 429) throw new Error("AI rate limit reached — try again shortly.");
    if (res.status === 402) throw new Error("خدمة الذكاء الاصطناعي غير متاحة مؤقتًا.");
    throw new Error("حدث خطأ في خدمة الذكاء الاصطناعي. حاول مرة أخرى.");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function callGatewayJson<T = unknown>(
  messages: ChatMessage[],
  opts: Omit<GatewayOptions, "responseFormat"> = {},
): Promise<T> {
  const raw = await callGateway(messages, { ...opts, responseFormat: "json_object" });
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract JSON block from a longer response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("AI returned malformed JSON");
  }
}
