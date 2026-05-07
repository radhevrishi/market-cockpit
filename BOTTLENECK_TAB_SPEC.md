# Bottleneck Intelligence Tab — Implementation Spec

## User Request
Add a new sidebar tab "Bottleneck" (or "Intelligence") to Market Cockpit that automates as much of Serenity's 37-model Bottleneck Investing Framework as possible. All data should be live/automated — no static or stale content.

## Source Document
`/sessions/hopeful-loving-brown/mnt/uploads/Serenity_Bottleneck_Investing_Framework.docx`
Full text extracted at: `/sessions/hopeful-loving-brown/mnt/.claude/projects/-sessions-hopeful-loving-brown/848bf60f-2762-44b1-9b03-0a3e302ead8c/tool-results/b6udo4hmr.txt`

## What CAN Be Automated (from existing Market Cockpit infrastructure)

### Section 1: Bottleneck Rotation Tracker (Model 04)
- **Source**: Existing `/api/v1/news/bottleneck-dashboard` API
- **Shows**: Which supply chain layer is currently the active bottleneck
- **Layers**: MEMORY_STORAGE, INTERCONNECT_PHOTONICS, FABRICATION_PACKAGING, COMPUTE_SCALING, POWER_GRID, NUCLEAR_ENERGY, THERMAL_COOLING, MATERIALS_SUPPLY, QUANTUM_CRYOGENICS
- **Data**: Severity level (CRITICAL/HIGH/ELEVATED/WATCH), signal count, article count, key tickers, evidence articles
- **Automation**: 100% automated — data already exists in the bottleneck dashboard API

### Section 2: Supply Chain Map (Model 01, 05, 18)
- **Source**: Hardcoded but accurate supply chain tiers from the framework
- **Shows**: Visual flowchart of AI infrastructure value chain:
  Raw Materials → Substrates → Equipment → Foundries → Chip Designers → Photonic Components → Modules/Transceivers → Test/Inspection → Advanced Packaging → System Integration
- **Data**: Each tier maps to specific companies (from framework + news tickers)
- **Automation**: 70% automated — tier structure is static, but companies within each tier can be enriched from news data

### Section 3: Bottleneck Stock Scanner (Model 02, 06, 10)
- **Source**: Companies mentioned in bottleneck news articles + their market data
- **Shows**: Table of bottleneck-related companies with:
  - Symbol, Company Name, Market Cap
  - Bottleneck Sub-Tag (which layer they're in)
  - Bottleneck Level (CRITICAL/BOTTLENECK/WATCH/RESOLVED)
  - Evidence count (how many articles mention them)
  - Size asymmetry flag (market cap < $2B)
  - Exchange (NSE/NYSE/NASDAQ/TSE/KRX/STO — flag non-US for cross-border arbitrage)
- **Data source**: Extract tickers from `/api/v1/news` bottleneck articles + `/api/market/quotes` for price data
- **Automation**: 80% automated

### Section 4: Serenity Checklist (Model framework Part V)
- **Shows**: Interactive checklist per stock — user manually tracks:
  - [ ] Supply chain position mapped
  - [ ] < 3 public competitors confirmed
  - [ ] Customer switching cost verified
  - [ ] Qualification stage: Pre-qual / Qual / Ramp / Volume
  - [ ] Customer count in qualification
  - [ ] Dilution check: shares outstanding growth < 10%/yr
  - [ ] Size asymmetry: market cap vs end-customer TAM
  - [ ] 5-source validation complete
  - [ ] Internal price target set
- **Storage**: localStorage per symbol (client-side, no backend needed)
- **Automation**: 0% — manual entry, but structured per framework

### Section 5: Conference Calendar (Model 22)
- **Shows**: Upcoming industry conferences relevant to bottleneck themes
- **Data**: Hardcoded calendar of major conferences:
  - NVDA GTC (March) — Photonics, AI chips, CPO
  - OFC (March) — Optical fiber, silicon photonics
  - TSMC OIP (October) — Advanced packaging
  - Hot Chips (August) — AI accelerators, memory
  - SEMICON West (July) — Equipment
  - IEEE IEDM (December) — Advanced nodes
- **Automation**: 30% — dates are annual, list is static but useful

### Section 6: Geopolitical Overlay (Model 25, 29, 36)
- **Source**: Existing news feed GEOPOLITICAL + TARIFF articles
- **Shows**: Active geopolitical events that accelerate or threaten bottleneck positions
- **Data**: From `/api/v1/news` filtered by article_type GEOPOLITICAL/TARIFF
- **Automation**: 90% automated — already in news system

### Section 7: Drilldown Knowledge Base
- **Source**: Already built in the news page — `BOTTLENECK_DRILLDOWN` object
- **Shows**: Per sub-tag: why it's a bottleneck, supply vs demand, winners/losers
- **Data**: 9 deep-tech categories with institutional narrative
- **Automation**: 100% — already implemented in news page, just needs to be exposed in new tab

## What CANNOT Be Automated (requires external paid APIs or manual research)
- SEC EDGAR filing search per company
- Wayback Machine website change tracking
- Conference presentation PDF parsing
- Private company investor deck analysis
- Short interest / 13F institutional ownership (requires Fintel/Ortex API)
- Qualification cycle stage detection from earnings transcripts
- Cross-border stock data for Sweden/Japan/Korea (requires IBKR or Bloomberg API)

## Architecture

### New Files to Create
1. `frontend/src/app/(dashboard)/bottleneck-intel/page.tsx` — Main page
2. No new API routes needed — uses existing:
   - `/api/v1/news/bottleneck-dashboard` — severity, signals, articles per bucket
   - `/api/v1/news` — bottleneck articles with tickers
   - `/api/market/quotes` — live prices for mentioned tickers

### Sidebar Entry
Add to the navigation sidebar (likely in a layout component):
- Icon: 🔬 or similar
- Label: "Intelligence" or "Bottleneck"
- Route: `/bottleneck-intel`

### Page Layout
```
┌─────────────────────────────────────────────────┐
│ BOTTLENECK INTELLIGENCE                          │
│ Serenity Framework · Live Supply Chain Analysis  │
├─────────────────────────────────────────────────┤
│ [Rotation] [Scanner] [Map] [Geo] [Calendar]     │ ← sub-tabs
├─────────────────────────────────────────────────┤
│                                                  │
│ SECTION CONTENT (based on active sub-tab)        │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Data Refresh
- Bottleneck dashboard: refetch every 3 minutes (existing API)
- News articles: refetch every 90 seconds (existing API)
- Quotes: refetch every 60 seconds (existing API)
- Conference calendar: static
- Checklist: localStorage, no refresh needed

## Key Design Principles
1. NO static or stale data — everything auto-refreshes
2. Dark theme matching existing Market Cockpit design
3. Mobile-responsive
4. Institutional-grade visual language
5. Each section answers a specific Serenity framework question

## Priority Order for Implementation
1. Bottleneck Rotation Tracker (highest value, 100% automated)
2. Bottleneck Stock Scanner (high value, 80% automated)
3. Drilldown Knowledge Base (already built, just needs tab)
4. Geopolitical Overlay (90% automated)
5. Supply Chain Map (visual, partially automated)
6. Conference Calendar (static but useful)
7. Serenity Checklist (manual but structured)
