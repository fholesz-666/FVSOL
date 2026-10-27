// Volání serverové funkce fvsol-intake a nahrávání souborů do soukromého úložiště přes podepsaný odkaz.
import { CONFIG } from "./config.js";

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(action, payload = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.functionsUrl}/fvsol-intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CONFIG.publishableKey },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new ApiError(`Spojení se serverem se nepodařilo. Zkontrolujte připojení, nebo napište na ${CONFIG.contactEmail}.`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Server odpověděl chybou ${res.status}.`, res.status, body.data || body);
  return body;
}

/** Nahrání souboru s průběhem: podepsaný odkaz → PUT (stejně jako supabase-js uploadToSignedUrl). */
export function putSigned(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", CONFIG.publishableKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`Nahrávání selhalo (${xhr.status}).`, xhr.status)));
    xhr.onerror = () => reject(new ApiError("Nahrávání přerušeno – zkontrolujte připojení a zkuste to znovu."));
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    xhr.send(fd);
  });
}
