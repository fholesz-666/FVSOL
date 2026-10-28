/**
 * Transakční e-maily.
 *  1. EmailJS (stejný účet jako kontaktní formulář webu) – když jsou nastavené EMAILJS_PRIVATE_KEY a EMAILJS_TEMPLATE_ID.
 *     Odesílá se ze schránky připojené v EmailJS, šablona má předmět {{subject}}, příjemce {{to_email}} a obsah {{{html}}}.
 *  2. Brevo – když je nastavený BREVO_API_KEY.
 *  Bez nastavení se nic neodesílá – událost se zapíše jako „neodesláno“ a systém funguje dál.
 * Texty nikdy netvrdí víc, než odpovídá skutečnému stavu zakázky.
 */
import { env, logEvent, SITE_URL } from "./util.ts";

export interface MailResult { sent: boolean; reason?: string; id?: string }

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function layout(title: string, body: string) {
  return `<!doctype html><html lang="cs"><body style="margin:0;background:#f4f5f6;font-family:Arial,Helvetica,sans-serif;color:#1d2125">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border:1px solid #d7dbdf">
<tr><td style="background:#000;color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">FVSOL<span style="color:#d63447">.</span></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #d7dbdf;font-size:12px;color:#5d6670">Filip Holesz · projektant FVE a hromosvodů · <a href="mailto:projekce@fvsol.cz" style="color:#5d6670">projekce@fvsol.cz</a> · +420 605 783 000</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 12px;line-height:1.5">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#d63447;color:#fff;text-decoration:none;padding:12px 18px;font-weight:bold">${esc(label)}</a></p>`;
const list = (items: string[]) => `<ul style="margin:0 0 12px;padding-left:20px;line-height:1.5">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

export const orderLink = (token: string) => `${SITE_URL()}/zadani/#t=${encodeURIComponent(token)}`;

export function mailProvider(): "emailjs" | "brevo" | null {
  if (env("EMAILJS_PRIVATE_KEY") && env("EMAILJS_TEMPLATE_ID")) return "emailjs";
  if (env("BREVO_API_KEY")) return "brevo";
  return null;
}

// EmailJS povoluje 1 požadavek za sekundu – e-maily z jedné instance funkce jdou za sebou s odstupem
let emailjsQueue: Promise<unknown> = Promise.resolve();
let emailjsLast = 0;

async function viaEmailjs(to: { email: string; name?: string }, subject: string, html: string): Promise<MailResult> {
  const run = async (): Promise<MailResult> => {
    const wait = emailjsLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    emailjsLast = Date.now();
    try {
      const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: env("EMAILJS_SERVICE_ID", "service_amm7txp"),
          template_id: env("EMAILJS_TEMPLATE_ID"),
          user_id: env("EMAILJS_PUBLIC_KEY", "jcI-Mfxs2Tj1RcLNA"),
          accessToken: env("EMAILJS_PRIVATE_KEY"),
          template_params: {
            to_email: to.email,
            to_name: to.name || "",
            subject,
            html,
            reply_to: env("MAIL_REPLY_TO", "projekce@fvsol.cz"),
            from_name: env("MAIL_FROM_NAME", "FVSOL – Filip Holesz"),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return res.ok ? { sent: true, id: "emailjs" } : { sent: false, reason: `EmailJS odpověděl ${res.status}: ${text}`.trim() };
    } catch (e) {
      return { sent: false, reason: `EmailJS není dostupný: ${String(e).slice(0, 120)}` };
    }
  };
  const p = emailjsQueue.then(run, run);
  emailjsQueue = p.catch(() => undefined);
  return p;
}

async function viaBrevo(kind: string, to: { email: string; name?: string }, subject: string, html: string): Promise<MailResult> {
  const from = env("MAIL_FROM", "projekce@fvsol.cz");
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: env("MAIL_FROM_NAME", "FVSOL – Filip Holesz") },
        to: [{ email: to.email, name: to.name || undefined }],
        replyTo: { email: env("MAIL_REPLY_TO", from) },
        subject,
        htmlContent: html,
        tags: ["fvsol", kind],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { sent: true, id: j.messageId } : { sent: false, reason: `Brevo odpovědělo ${res.status}: ${j.message ?? ""}`.trim() };
  } catch (e) {
    return { sent: false, reason: `Brevo není dostupné: ${String(e).slice(0, 120)}` };
  }
}

export async function sendMail(orderId: string | null, kind: string, to: { email: string; name?: string }, subject: string, html: string): Promise<MailResult> {
  const provider = mailProvider();
  const result: MailResult = provider === "emailjs" ? await viaEmailjs(to, subject, html)
    : provider === "brevo" ? await viaBrevo(kind, to, subject, html)
    : { sent: false, reason: "Odesílání e-mailů není nastavené (EmailJS ani Brevo) – e-mail se neodeslal." };
  if (orderId) await logEvent(orderId, "email", result.sent ? `E-mail odeslán: ${subject}` : `E-mail neodeslán: ${subject}`, { kind, to: to.email, provider, ...result });
  return result;
}

export function mailConfirmation(code: string, token: string, serviceTitle: string, missingLater: string[]) {
  const body =
    p(`děkuji za zadání <b>${esc(code)}</b> (${esc(serviceTitle)}). Podklady zkontroluji a ozvu se s nabídkou.`) +
    (missingLater.length ? p("Až to budete mít po ruce, budu potřebovat ještě:") + list(missingLater) : "") +
    p("Stav zakázky a doplnění podkladů najdete na tomto odkazu. Odkaz je jen pro vás, neposílejte ho dál.") +
    btn(orderLink(token), "Otevřít zakázku");
  return { subject: `Zadání ${code} jsem přijal`, html: layout(`Zadání ${code} jsem přijal`, body) };
}

export function mailResume(token: string) {
  const body = p("posílám odkaz na rozpracované zadání. Můžete pokračovat, kdykoli se vám to hodí.") + btn(orderLink(token), "Pokračovat v zadání") +
    p("Rozpracované zadání ještě není objednávka – odesláte ho až v posledním kroku.");
  return { subject: "Odkaz na rozpracované zadání", html: layout("Rozpracované zadání", body) };
}

export function mailInfoRequest(code: string, token: string, message: string, items: string[]) {
  const body = p(`k zakázce <b>${esc(code)}</b> prosím o doplnění:`) + (items.length ? list(items) : "") +
    (message ? p(esc(message).replace(/\n/g, "<br>")) : "") + btn(orderLink(token), "Doplnit podklady");
  return { subject: `Doplnění podkladů k zakázce ${code}`, html: layout(`Doplnění podkladů – ${code}`, body) };
}

export function mailConfirmed(code: string, token: string) {
  const body = p(`zakázku <b>${esc(code)}</b> jsem zařadil ke zpracování. Jakmile bude dokumentace hotová a zkontrolovaná, pošlu vám ji.`) + btn(orderLink(token), "Stav zakázky");
  return { subject: `Zakázka ${code} je ve zpracování`, html: layout(`Zakázka ${code} je ve zpracování`, body) };
}

/** Volá se jen ve chvíli, kdy existuje ověřený a uvolněný výstup. */
export function mailReleased(code: string, token: string, files: string[]) {
  const body = p(`dokumentace k zakázce <b>${esc(code)}</b> je připravená ke stažení:`) + list(files) + btn(orderLink(token), "Stáhnout dokumentaci");
  return { subject: `Dokumentace ${code} je připravená`, html: layout(`Dokumentace ${code}`, body) };
}

export function mailNewOrder(code: string, adminUrl: string, lines: string[]) {
  const body = p(`Nové zadání <b>${esc(code)}</b> z webu.`) + list(lines) + btn(adminUrl, "Otevřít v administraci");
  return { subject: `Nové zadání ${code}`, html: layout(`Nové zadání ${code}`, body) };
}

export function mailCustomerReply(code: string, adminUrl: string, text: string) {
  const body = p(`Zákazník doplnil podklady k zakázce <b>${esc(code)}</b>.`) + (text ? p(esc(text).replace(/\n/g, "<br>")) : "") + btn(adminUrl, "Otevřít v administraci");
  return { subject: `Doplněno: ${code}`, html: layout(`Doplněno: ${code}`, body) };
}

export function mailTest() {
  return { subject: "FVSOL – zkušební e-mail", html: layout("Zkušební e-mail", p("Odesílání e-mailů z administrace FVSOL funguje.")) };
}
