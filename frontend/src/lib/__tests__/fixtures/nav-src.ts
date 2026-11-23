// zzz1294 — the sidebar is built from lib/nav-hubs.ts; wiring tests read both files (and the hub links written out as
// sidebar entries) as one navigation source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUBS } from '../../nav-hubs';
const root = join(__dirname, '..', '..', '..');
export function navSrc(): string {
  const items = HUBS.flatMap((h) => h.tabs.flatMap((t) => [
    `{ href: '${t.href}', label: '${t.label}${t.us ? ' (India)' : ''}' },`,
    ...(t.us ? [`{ href: '${t.us}', label: 'US ${t.label}' },`] : []),
    ...(t.more || []).map((m) => `{ href: '${m.href}', label: '${m.label}' },`),
  ]));
  return readFileSync(join(root, 'app/(dashboard)/DashboardClient.tsx'), 'utf8') + '\n' + readFileSync(join(root, 'lib/nav-hubs.ts'), 'utf8') + '\n' + items.join('\n');
}
