// zzz1300 — same-day round-trip bulk / block deals (one party buys and sells about the same quantity) carry no view.
/** zzz1300 — party + company + day (+ deal kind) for a bulk / block deal. */
export function dealPartyKey(d: { symbol?: string; clientName?: string; dealDate?: string; type?: string }): string {
  return [String(d.symbol || '').toUpperCase().trim(), String(d.clientName || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), String(d.dealDate || ''), String(d.type || '')].join('|');
}
/** zzz1300 — keys of deals where one party bought and sold about the same quantity (within 20%) the same day. */
export function roundTripDealKeys(deals: Array<{ symbol?: string; clientName?: string; dealDate?: string; type?: string; buySell?: string; quantity?: number }>): Set<string> {
  const buy = new Map<string, number>(), sell = new Map<string, number>();
  for (const d of deals) {
    const k = dealPartyKey(d), q = Number(d.quantity) || 0;
    const m = /buy/i.test(String(d.buySell || '')) ? buy : sell;
    m.set(k, (m.get(k) || 0) + q);
  }
  const out = new Set<string>();
  for (const [k, b] of buy) { const sl = sell.get(k) || 0; if (b > 0 && sl > 0 && Math.min(b, sl) / Math.max(b, sl) >= 0.8) out.add(k); }
  return out;
}

