'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';

interface MarketItem {
  label: string;
  value: string;
  change: number;
  changeStr: string;
}

interface Props {
  items: MarketItem[];
}

export default function GlobalMarketsBar({ items }: Props) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto scrollbar-none bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex items-center gap-3 px-4 py-2.5 shrink-0 ${i < items.length - 1 ? 'border-r border-[#2A3B4C]' : ''}`}
        >
          <span className="text-[#8899AA] text-xs font-medium">{item.label}</span>
          <span className="text-white text-sm font-semibold">{item.value}</span>
          <span className={`flex items-center gap-0.5 text-xs font-medium ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {item.change >= 0
              ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />
            }
            {item.changeStr}
          </span>
        </div>
      ))}
    </div>
  );
}
