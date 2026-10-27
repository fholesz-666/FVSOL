// Společné pomůcky pro Edge funkce FVSOL (Deno).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const env = (k: string, d = "") => Deno.env.get(k) ?? d;

export const SITE_URL = () => env("SITE_URL", "https://fvsol.cz").replace(/\/$/, "");

const DEFAULT_ORIGINS = "https://fvsol.cz,https://www.fvsol.cz,https://fholesz-666.github.io";

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = env("FVSOL_ORIGINS", DEFAULT_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || allowed[0] : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export class HttpError extends Error {
  status: number;
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

let _admin: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "0.0.0.0";
}

export async function ipHash(req: Request): Promise<string> {
  // IP se neukládá – jen otisk se solí pro limity a dohledání zneužití.
  return (await sha256hex(env("IP_SALT", "fvsol") + "|" + clientIp(req))).slice(0, 32);
}

export async function rateLimit(key: string, windowSec: number, max: number) {
  const { data, error } = await admin().rpc("hit_rate_limit", { p_key: key, p_window_seconds: windowSec, p_max: max });
  if (error) {
    console.warn("rate_limit_failed", error.message);
    return; // výpadek limitu nesmí zablokovat zákazníky
  }
  if (data === false) throw new HttpError(429, "Příliš mnoho požadavků. Zkuste to prosím za chvíli.");
}

export function safeFileName(name: string): string {
  const base = String(name || "soubor").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (cleaned || "soubor").slice(-120);
}

export async function logEvent(
  orderId: string,
  type: string,
  message: string | null,
  data: Record<string, unknown> = {},
  opts: { actor?: string; visible?: boolean } = {},
) {
  const { error } = await admin().from("order_events").insert({
    order_id: orderId,
    type,
    message,
    data,
    actor: opts.actor ?? "system",
    visible_to_customer: opts.visible ?? false,
  });
  if (error) console.warn("event_insert_failed", error.message);
}

export function fmtDateCz(d: Date | string = new Date()): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" }).format(x);
}

export function str(v: unknown, max = 300): string {
  return String(v ?? "").slice(0, max);
}
