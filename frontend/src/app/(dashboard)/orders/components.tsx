'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { type ExtractedSignal } from './types';

export const biasIcon = (b: string) => b === 'Bullish' ? <TrendingUp size={16} /> : b === 'Bearish' ? <TrendingDown size={16} /> : <Minus size={16} />;
// ── Reusable Signal Card — ensures consistent display of label + subject + evidence ──
export function SignalCard({ sig, horizonColor }: { sig: ExtractedSignal; horizonColor: (h:string)=>string }) {
  const c = sig.positive ? '#10b981' : '#ef4444';
  const originBadge = sig.origin === 'SECTOR' ? '🌍' : sig.origin === 'DERIVED' ? '🔮' : '🏢';
  return (
    <div style={{padding:'10px 12px',backgroundColor:sig.positive?'color-mix(in srgb, var(--mc-bullish) 3%, transparent)':'color-mix(in srgb, var(--mc-bearish) 3%, transparent)',border:`1px solid ${sig.positive?'color-mix(in srgb, var(--mc-bullish) 13%, transparent)':'color-mix(in srgb, var(--mc-bearish) 13%, transparent)'}`,borderLeft:`3px solid ${c}`,borderRadius:7}}>
      <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:5,flexWrap:'wrap'}}>
        {/* Signal label + subject together — the key fix */}
        <span style={{fontSize:11,fontWeight:800,color:c}}>
          {sig.positive?'↑':'↓'} {sig.type.replace(/_/g,' ')}:&nbsp;
          <span style={{fontWeight:600,color:'var(--mc-text-2)'}}>{sig.subject}</span>
        </span>
        {sig.dupCount && sig.dupCount > 1 && (
          <span style={{fontSize:8,color:'var(--mc-text-4)',border:'1px solid var(--mc-bg-4)',padding:'0 4px',borderRadius:3}}>×{sig.dupCount} merged</span>
        )}
        <span title={`Origin: ${sig.origin}`} style={{fontSize:9,color:'var(--mc-text-4)'}}>{originBadge} {sig.origin}</span>
        <span style={{fontSize:9,color:'var(--mc-text-4)',fontStyle:'italic'}}>{sig.temporality}</span>
        <span style={{fontSize:9,fontWeight:700,color:horizonColor(sig.horizon),border:`1px solid ${horizonColor(sig.horizon)}40`,padding:'1px 5px',borderRadius:3}}>{sig.horizon}</span>
        {sig.numerical && (
          <span style={{fontSize:10,fontWeight:800,color:'var(--mc-warn)',border:'1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',padding:'2px 7px',borderRadius:3}}>
            ₹{sig.numerical.value}{sig.numerical.unit}{sig.numerical.timing?` · ${sig.numerical.timing}`:''}
          </span>
        )}
        <span style={{fontSize:8,color:'var(--mc-text-4)',marginLeft:'auto'}}>{sig.date?new Date(sig.date).toLocaleDateString('en-IN'):''}</span>
      </div>
      {/* Evidence sentence — MANDATORY. If missing, flag it */}
      {sig.text && sig.text.length >= 15 ? (
        <div style={{fontSize:11,color:'var(--mc-text-2)',lineHeight:1.6,backgroundColor:'#060E1A',padding:'6px 10px',borderRadius:5,borderLeft:'2px solid var(--mc-text-4)',marginBottom:4}}>
          "{sig.text}"
        </div>
      ) : (
        <div style={{fontSize:10,color:'var(--mc-warn)',padding:'4px 8px',backgroundColor:'color-mix(in srgb, var(--mc-warn) 3%, transparent)',borderRadius:4,marginBottom:4}}>
          ⚠ No traceable evidence sentence — do not act on this signal
        </div>
      )}
      <div style={{fontSize:9,color:'var(--mc-text-4)'}}>📰 {sig.source || 'Unknown source'}</div>
    </div>
  );
}
