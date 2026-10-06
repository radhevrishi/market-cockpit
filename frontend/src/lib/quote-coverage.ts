// zzz883 — how much of an AI-supplied quote really appears in the source document.
// The old checks only required the first 60 characters, so the END of a quote — usually where the number is — could be invented.
// Now the matched part must cover at least 85% of the quote (a model that tacks a short clause onto the end is still accepted).
export function coveredPrefix(corpusNorm: string, quoteNorm: string): number {
  let lo = 0, hi = quoteNorm.length;
  while (lo < hi) {   // longest prefix of the quote present in the corpus (binary search on length)
    const mid = Math.ceil((lo + hi) / 2);
    if (corpusNorm.includes(quoteNorm.slice(0, mid))) lo = mid; else hi = mid - 1;
  }
  return lo;
}
export function quoteMostlyInDocument(corpusNorm: string, quoteNorm: string, minShare = 0.85, minChars = 25): boolean {
  if (quoteNorm.length < minChars) return false;
  return coveredPrefix(corpusNorm, quoteNorm) >= Math.max(Math.min(60, quoteNorm.length), Math.ceil(quoteNorm.length * minShare));
}
