// zzz1302 — the Bounce Desk is now the "Oversold bounce" view of the Entry Desk (/cheat-entry), with the same rules
// (regime gate, decay refusal, above the 200-day) on the same rows as the support entries. Old links keep working.
import { redirect } from 'next/navigation';
export default function BounceDeskPage() {
  redirect('/cheat-entry?lens=bounce');
}
