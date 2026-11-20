/** Eenvoudige HTTP-helpers met retries en nette foutmeldingen. */

export async function fetchRetry(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      const wait = 1000 * 2 ** i;
      console.warn(`  ! ${short(url)} mislukt (${(e as Error).message}); opnieuw over ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Ophalen mislukt na ${tries} pogingen: ${url}\n${(lastErr as Error)?.message}`);
}

export async function getJSON<T = any>(url: string): Promise<T> {
  const res = await fetchRetry(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function getText(url: string): Promise<string> {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`);
  return res.text();
}

export async function getBuffer(url: string): Promise<{ buf: ArrayBuffer; type: string }> {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}: ${(await res.text()).slice(0, 300)}`);
  return { buf: await res.arrayBuffer(), type: res.headers.get('content-type') ?? '' };
}

/**
 * Bestaat de URL? Let op: sommige PDOK-servers geven HTTP 200 met de tekst
 * "not found" terug, dus de inhoud wordt gecontroleerd met `valid`.
 */
export async function exists(url: string, valid: (body: string) => boolean = () => true): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { await res.body?.cancel(); return false; }
    const body = await res.text();
    return !/^\s*not found\s*$/i.test(body) && valid(body);
  } catch {
    return false;
  }
}

export function short(url: string): string {
  return url.length > 110 ? url.slice(0, 107) + '…' : url;
}
