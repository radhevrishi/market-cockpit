import { cn } from '@/lib/utils';

interface Props { className?: string }

export function Skeleton({ className }: Props) {
  return (
    <div className={cn('animate-pulse rounded-lg bg-[#1A2B3C]', className)} />
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-[#2A3B4C]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-3 w-20" />
        </td>
      ))}
    </tr>
  );
}
