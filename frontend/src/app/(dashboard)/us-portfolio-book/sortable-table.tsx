// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — a table you can sort by clicking any column.   (zzz793)
//
// Click a header to sort by it; click again to flip. ▲ = smallest first,
// ▼ = largest first. Numbers sort as numbers, text as text; blanks ("—")
// always go to the bottom. Sorting logic is the tested
// lib/us-book/analytics sortRows / compareSortValues.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { sortRows, type SortDir, type SortValue } from '@/lib/us-book/analytics';

export interface Col<T> {
  key: string;
  label: string;
  /** The value sorted on. Omit to make the column not sortable. */
  sort?: (r: T) => SortValue;
  render: (r: T) => ReactNode;
  align?: 'left' | 'right';
  title?: string;
  /** Direction on first click. Default: desc for numbers, asc for text. */
  firstDir?: SortDir;
}

const C = { border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)', faint: 'var(--tc-faint, #AEBBCB)', cyan: 'var(--tc-accent, #22D3EE)' };

export function SortableTable<T>({ rows, cols, rowKey, defaultSort, footer, testId, rowStyle, compact }: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  defaultSort?: { key: string; dir: SortDir };
  footer?: ReactNode;
  testId?: string;
  rowStyle?: (r: T) => React.CSSProperties | undefined;
  compact?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort || null);
  const sorted = useMemo(() => {
    const col = sort ? cols.find((c) => c.key === sort.key) : null;
    return col?.sort ? sortRows(rows, col.sort, sort!.dir) : rows;
  }, [rows, cols, sort]);
  const click = (c: Col<T>) => {
    if (!c.sort) return;
    if (sort?.key === c.key) { setSort({ key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }); return; }
    let first: SortDir = c.firstDir || 'asc';
    if (!c.firstDir) { const sample = rows.map(c.sort).find((v) => v != null && v !== ''); first = typeof sample === 'number' ? 'desc' : 'asc'; }
    setSort({ key: c.key, dir: first });
  };
  const pad = compact ? '3px 6px' : '5px 7px';
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid={testId} style={{ width: '100%', borderCollapse: 'collapse', fontSize: compact ? 12.5 : 13 }}>
        <thead>
          <tr style={{ color: C.faint, fontSize: 11.5, textTransform: 'uppercase' }}>
            {cols.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} title={c.title || (c.sort ? `Sort by ${c.label}` : undefined)}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}
                  style={{ padding: pad, textAlign: c.align || 'left', whiteSpace: 'nowrap', fontWeight: 800 }}>
                  {c.sort ? (
                    <button type="button" onClick={() => click(c)} style={{ all: 'unset', cursor: 'pointer', color: active ? C.cyan : C.faint, fontWeight: 800 }}>
                      {c.label}{' '}<span aria-hidden style={{ opacity: active ? 1 : 0.45 }}>{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} style={{ borderTop: `1px solid ${C.border}`, ...(rowStyle?.(r) || {}) }}>
              {cols.map((c) => <td key={c.key} style={{ padding: pad, textAlign: c.align || 'left', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {sort && <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>Sorted by {cols.find((c) => c.key === sort.key)?.label || sort.key}, {sort.dir === 'asc' ? 'smallest / A first' : 'largest / Z first'} — click any column heading to sort; blanks always go last.</div>}
    </div>
  );
}
