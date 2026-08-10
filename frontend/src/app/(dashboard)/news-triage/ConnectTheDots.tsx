'use client';
// zzz326-placeholder — Minimal stub so the news-triage import resolves and Railway builds.
// Replace this file's contents by uploading the full ConnectTheDots.tsx via GitHub drag-drop.
import React from 'react';

const C = { bg: '#0B0E14', panel: '#11151F', border: '#1F2937', text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', cyan: '#06B6D4', gold: '#FBBF24' };

export default function ConnectTheDots() {
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '60px 28px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <h1 style={{ fontSize: 32, margin: '0 0 12px', color: C.text, letterSpacing: '-0.5px' }}>Connect The Dots</h1>
        <p style={{ fontSize: 16, color: C.text2, lineHeight: 1.6, marginBottom: 32 }}>
          Investing knowledge hub with company read-throughs, commodity chains, supply-chain maps, capex chains,
          policy chains, and historical case studies. The full 25-framework library is being uploaded.
        </p>
        <div style={{ background: C.panel, border: '1px solid ' + C.border, borderRadius: 10, padding: 24, textAlign: 'left', maxWidth: 700, margin: '0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.cyan, letterSpacing: '0.6px', marginBottom: 12, textTransform: 'uppercase' }}>
            15 Categories Coming
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, fontSize: 13, color: C.text2 }}>
            <div>🔗 Company Read-Throughs</div>
            <div>⛏️ Commodity Chains</div>
            <div>🕸️ Supply Chain Maps</div>
            <div>🏗️ Capex Chains</div>
            <div>📊 Earnings Cycles</div>
            <div>📦 Order Flow</div>
            <div>🏛️ Policy Chains</div>
            <div>🌍 Geopolitics</div>
            <div>💰 Interest Rate Chains</div>
            <div>💱 Currency Chains</div>
            <div>🤖 AI Supercycle</div>
            <div>🏭 Infra Supercycle</div>
            <div>💎 Hidden Beneficiaries</div>
            <div>🧬 Sector Dependency</div>
            <div>📜 Historical Case Studies</div>
          </div>
        </div>
      </div>
    </div>
  );
}

