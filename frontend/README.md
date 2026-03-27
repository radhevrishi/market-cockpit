# Market Cockpit Frontend

A Bloomberg-style financial dashboard for active equity investors covering India and US markets. Built with Next.js 14, TypeScript, Tailwind CSS, and modern React patterns.

## Features

- **Mission Control**: Real-time portfolio overview with heatmap visualization
- **News Feed**: Market news with filters, importance levels, and ticker tracking
- **Calendars**: Earnings, economic events, ratings changes, and dividends
- **Portfolios**: Position management with detailed P&L analysis
- **AI Desk**: Morning/evening briefs and intelligent chat interface
- **Global Markets**: Live ticker strip with indices, FX, and commodities
- **Dark Mode**: Navy and teal color scheme optimized for market data visualization

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS with dark mode
- **State Management**: Zustand
- **HTTP Client**: Axios with interceptors
- **Components**: Radix UI primitives + Custom shadcn/ui-style components
- **Real-time**: Socket.io ready
- **Charts**: Lightweight Charts, Recharts ready

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # Dashboard layout group
│   │   │   ├── layout.tsx         # Sidebar + header
│   │   │   ├── page.tsx           # Mission Control
│   │   │   ├── news/
│   │   │   ├── calendars/
│   │   │   ├── portfolios/
│   │   │   ├── ai-desk/
│   │   │   ├── themes/
│   │   │   └── settings/
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── components/               # Reusable components (extensible)
│   ├── types/                    # TypeScript definitions
│   ├── lib/
│   │   └── api.ts               # Axios API client
│   ├── stores/
│   │   └── appStore.ts          # Zustand global state
│   └── hooks/                    # Custom React hooks (extensible)
├── package.json
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
└── postcss.config.js
```

## Getting Started

### Prerequisites
- Node.js 18+ (for Next.js 14)
- npm or yarn

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
npm start
```

## Environment Variables

Create a `.env.local` file based on `.env.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here
```

## Key Components & Pages

### Dashboard Layout
- Collapsible 120px sidebar navigation
- Global markets ticker strip (Nifty50, S&P500, USD/INR, Gold)
- User avatar dropdown
- Responsive design (mobile-friendly)

### Pages

1. **Mission Control** (`/`)
   - Portfolio summary cards
   - Heatmap of positions
   - Today's events calendar strip
   - Must-know headlines
   - Top gainers/losers

2. **News** (`/news`)
   - Searchable news feed
   - In-play ticker badges
   - Importance and sentiment badges
   - Customizable filters (market, sector, type, importance)

3. **Calendars** (`/calendars`)
   - Earnings calendar with week view grid
   - Economic events with impact badges
   - Rating changes with analyst details
   - Dividend announcements

4. **Portfolios** (`/portfolios`)
   - Portfolio selector tabs
   - Position table with P&L metrics
   - Add/edit/delete positions
   - Real-time valuation

5. **AI Desk** (`/ai-desk`)
   - Morning/Evening briefs
   - AI chat interface
   - Saved briefs library
   - Copy-to-clipboard insights

## API Integration

The app uses a typed Axios client (`/src/lib/api.ts`) that provides methods for:

- News: `getNews()`, `searchNews()`
- Calendars: `getEarningsCalendar()`, `getEconomicCalendar()`, etc.
- Portfolios: `getPortfolios()`, `getPositions()`, `addPosition()`
- Quotes: `getQuote()`, `getQuotes()`
- AI: `getAIMorningBrief()`, `getAIEveningBrief()`, `getAIChatResponse()`

All methods support error handling and automatic JWT token injection.

## State Management

Uses Zustand (`/src/stores/appStore.ts`) for:
- User authentication
- Portfolio selection
- News filters
- Alert management
- UI state (theme, sidebar, notifications)

## Styling Notes

- **Dark Mode First**: Configured with Tailwind `darkMode: 'class'`
- **Custom Colors**: Navy (#1E3A5F) and accent blue (#0F7ABF)
- **Responsive**: Mobile-first, tested on sm/md/lg/xl breakpoints
- **Utilities**: Pre-built `.badge`, `.btn`, `.card`, `.input` classes

## Mock Data

The app comes with realistic mock data for:
- 6 positions (3 India: RELIANCE, INFY, TCS; 3 US/Global: NVDA, TSLA)
- 10+ news articles with various importance levels
- Earnings events with beat/miss scenarios
- Economic calendars with real indicators

Perfect for UI development and testing without a backend.

## Future Enhancements

- [ ] Real-time WebSocket integration via Socket.io
- [ ] Chart components (lightweight-charts, Recharts)
- [ ] Export to PDF/Excel
- [ ] Mobile app (React Native)
- [ ] Watchlist management
- [ ] Alert rules builder
- [ ] Custom dashboards

## Contributing

Contributions welcome! Please ensure:
- TypeScript strict mode compliance
- Tailwind CSS utilities (no custom CSS except globals)
- Component organization in `/src/components`
- Proper type definitions in `/src/types`

## License

MIT
