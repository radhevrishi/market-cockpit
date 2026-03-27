# Market Cockpit Frontend - Getting Started Guide

## Quick Start (5 minutes)

### 1. Installation

```bash
cd /sessions/cool-quirky-mayer/market-cockpit/frontend
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

Visit **http://localhost:3000** in your browser.

### 3. Explore Features

The app loads with mock data ready to explore:

| Page | Route | Features |
|------|-------|----------|
| **Mission Control** | `/` | Portfolio overview, heatmap, events, headlines |
| **News Feed** | `/news` | Searchable articles with filters & sentiment |
| **Calendars** | `/calendars` | Earnings, economic, ratings, dividends |
| **Portfolios** | `/portfolios` | Position management with P&L tracking |
| **AI Desk** | `/ai-desk` | Morning/evening briefs + chat interface |
| **Themes** | `/themes` | Placeholder for thematic analysis |
| **Settings** | `/settings` | Placeholder for preferences |

---

## Architecture Overview

### File Organization

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout (dark mode, fonts, providers)
│   ├── globals.css              # Tailwind + CSS variables + global styles
│   └── (dashboard)/             # Layout group for authenticated routes
│       ├── layout.tsx           # Sidebar + header + market ticker
│       ├── page.tsx             # Mission Control (home)
│       ├── news/page.tsx        # News feed
│       ├── calendars/page.tsx   # Calendar events
│       ├── portfolios/page.tsx  # Position management
│       ├── ai-desk/page.tsx     # AI briefs & chat
│       ├── themes/page.tsx      # (Placeholder)
│       └── settings/page.tsx    # (Placeholder)
├── types/
│   └── index.ts                 # Complete TypeScript interfaces
├── lib/
│   └── api.ts                   # Axios API client with interceptors
├── stores/
│   └── appStore.ts              # Zustand global state
├── components/                  # (Ready for reusable components)
└── hooks/                       # (Ready for custom hooks)
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 14 App Router | Server-side rendering + routing |
| **Language** | TypeScript | Type safety across app |
| **Styling** | Tailwind CSS | Utility-first, dark mode |
| **State** | Zustand | Global state (user, portfolios, alerts) |
| **HTTP** | Axios | API calls with auto JWT injection |
| **Components** | React 18 | UI building blocks |
| **Fonts** | Next.js Inter | System font optimization |

---

## Key Components Explained

### 1. Dashboard Layout (`src/app/(dashboard)/layout.tsx`)

**Provides:**
- Left sidebar (120px) with 7 navigation items
- Top header with global markets ticker
- User dropdown menu
- Mobile responsive design
- Active route highlighting

**Sidebar Items:**
- 🎯 Mission Control (home)
- 📰 News
- 📅 Calendars
- 💼 Portfolios
- 🧭 Themes
- 🤖 AI Desk
- ⚙️ Settings

**Global Markets Ticker:**
- NIFTY50 (India)
- SENSEX (India)
- S&P500 (US)
- NASDAQ (US)
- USD/INR (Currency)
- GOLD (Commodity)

Each shows: Price, Change (₹/$), Change (%)

### 2. Mission Control (`src/app/(dashboard)/page.tsx`)

**Displays:**
1. **Summary Cards** (4-column grid)
   - Portfolio Value: ₹933K
   - Today's P&L: ₹218K (+2.35%)
   - Total Return: ₹44K (+4.73%)
   - Positions Count: 5

2. **Portfolio Heatmap**
   - 6 grid tiles (one per position)
   - Color: Green (gains) / Red (losses)
   - Shows ticker, company, day change %
   - Hover effect with scaling

3. **Today's Events**
   - 3 mock events (RELIANCE Q4, FOMC, NVDA Call)
   - Time and priority badges

4. **Top Movers**
   - Gainers: TATAMOTORS, RELIANCE, TCS
   - Losers: INFY, TSLA
   - Shows ticker, name, %, price

5. **Must-Know Headlines**
   - 5 articles with importance badges
   - Sentiment colors
   - Source and time

### 3. News Feed (`src/app/(dashboard)/news/page.tsx`)

**Features:**
- **Search Bar**: Real-time filtering by headline/content
- **In Play Tickers**: Top 3 tickers with activity count
- **Filter Panel**: 
  - Importance: Critical, High, Medium, Low
  - Type: Earnings, Macro, Market News, Corporate Action
- **News Cards**:
  - Sentiment dot (bullish/bearish/neutral)
  - Importance badge with color
  - Headline and 2-line preview
  - Ticker mentions (badges)
  - Source and time-ago

**Mock Data**: 10 articles covering NVDA, RELIANCE, TCS, INFY, TSLA, RBI, Fed

### 4. Calendars (`src/app/(dashboard)/calendars/page.tsx`)

**Tabs:**

1. **Earnings**
   - Week grid view (4 columns)
   - 8 companies (India + US)
   - Cards show: ticker, company, date/time, EPS estimate, actual (if reported)
   - Status badge: Upcoming / Reported

2. **Economic**
   - List view with 5 events
   - Importance: CRITICAL, HIGH
   - Shows: Forecast, Previous, Actual
   - Events: ADP, Jobless Claims, RBI Policy, US CPI, NFP

3. **Ratings**
   - 5 analyst rating changes
   - Old rating → New rating → Target price
   - Shows analyst firm and date

4. **Dividends**
   - 4 upcoming dividend events
   - Ex-date and payment date
   - Dividend per share amount

### 5. Portfolios (`src/app/(dashboard)/portfolios/page.tsx`)

**Features:**
- **Portfolio Tabs**: India Growth, US Tech, Global Themes
- **Summary Cards**: Value, Day P&L, Total Return, Position Count
- **Position Table**:
  - Columns: Ticker | Company | Qty | Avg Cost | CMP | P&L (₹) | P&L % | Weight | Next Earnings | Delete
  - Color-coded P&L (green/red)
  - Trending icons
  - Sortable (ready for implementation)
- **Add Position Button**: Form modal with ticker, exchange, qty, cost, date
- **Mock Positions**: 5 holdings (RELIANCE, INFY, TCS, NVDA, TATAMOTORS)

### 6. AI Desk (`src/app/(dashboard)/ai-desk/page.tsx`)

**Tabs:**

1. **Morning Brief**
   - Bloomberg-style report card
   - 6 insight bullet points:
     - Portfolio Performance
     - Top Movers
     - Today's Events
     - Risk Alerts
     - Sector Insight
     - Key Action
   - Copy-to-clipboard for each point
   - Save/Export/Share buttons

2. **Evening Brief**
   - Same structure as morning brief
   - Different content

3. **Chat**
   - Message interface
   - User messages (right, blue bubble)
   - AI responses (left, dark bubble)
   - Timestamp on each message
   - Input bar with send button
   - Auto-scroll to latest message

4. **Saved Briefs**
   - Grid of historical briefs
   - Date, title, type badge
   - Preview text
   - "View Brief" button

---

## Global State Management (Zustand)

Location: `src/stores/appStore.ts`

### State Sections

```typescript
// User Authentication
user: UserProfile | null
authToken: string | null
isAuthenticated: boolean

// Portfolio Management
portfolios: Portfolio[]
activePortfolioId: string | null
activePortfolio: Portfolio | null

// News & Content
newsArticles: NewsArticle[]
newsFilter: NewsFilter
newsLoading: boolean
searchQuery: string

// Notifications & Alerts
alerts: AlertInstance[]
unreadAlertCount: number

// UI State
theme: 'dark' | 'light'
sidebarCollapsed: boolean
globalLoadingState: boolean
notifications: [{ id, type, message }]
```

### Usage Example

```typescript
import { useAppStore } from '@/stores/appStore';

// In your component
const { user, activePortfolio, setActivePortfolio } = useAppStore();

// Update state
setActivePortfolio('p1');
```

---

## API Integration

Location: `src/lib/api.ts`

### Usage

```typescript
import { apiClient } from '@/lib/api';

// Fetch news
const newsData = await apiClient.getNews({ 
  page: 1, 
  limit: 20,
  filter: { markets: ['india', 'us'] }
});

// Get portfolio
const portfolio = await apiClient.getPortfolioById('p1');

// Add position
const newPos = await apiClient.addPosition('p1', {
  ticker: 'NVDA',
  exchange: 'NASDAQ',
  quantity: 10,
  avgCostPrice: 450,
  buyDate: '2024-03-01'
});
```

### Key Features

- **Auto JWT Injection**: `Authorization: Bearer {token}` added to all requests
- **401 Handling**: Auto-redirect to /login on auth failure
- **Type Safety**: Full TypeScript generics on responses
- **Error Handling**: Centralized error parsing and throwing

---

## Styling System

### Tailwind Configuration

**Dark Mode**: Enabled by default on `<html class="dark">`

**Custom Colors**:
```typescript
brand: {
  navy: '#1E3A5F',        // Main brand color
  'accent-blue': '#0F7ABF', // Accent for highlights
  teal: '#06B6D4',        // Secondary accent
}
neutral: {
  'bg-dark': '#0A0E27',          // Main background
  'bg-card': '#111B35',          // Card background
  'text-primary': '#F5F7FA',    // Primary text
  'text-secondary': '#B8BFCC', // Secondary text
}
status: {
  up: '#10B981',    // Green (gains)
  down: '#EF4444',  // Red (losses)
  warning: '#F59E0B', // Orange (alerts)
}
```

### Global Classes (in globals.css)

```css
.card                    /* Card container with border */
.card-hover             /* Card with hover state */
.badge                  /* Small label element */
.badge-primary/success/danger/warning
.btn                    /* Button base */
.btn-primary/secondary/ghost
.input                  /* Form input with focus state */
.gradient-text          /* Blue → Teal gradient text */
```

### Usage

```tsx
// Card
<div className="card p-6">
  <h2 className="text-lg font-semibold">Title</h2>
  <p className="text-neutral-text-secondary">Subtitle</p>
</div>

// Button
<button className="btn btn-primary px-6 py-3">
  Click me
</button>

// Badge
<span className="badge badge-success">✓ Success</span>

// Input
<input className="input w-full" placeholder="Search..." />
```

---

## Type Safety

All TypeScript interfaces are in `src/types/index.ts`:

```typescript
// Import types
import { 
  Portfolio, 
  Position, 
  NewsArticle, 
  CalendarEvent,
  AIBrief,
  Quote 
} from '@/types';

// Use in components
const portfolio: Portfolio = { ... };
const position: Position = { ... };
```

---

## Mock Data

The app comes with realistic mock data:

### Positions (5 Holdings)
- **India**: RELIANCE.NS, INFY.NS, TCS.NS, TATAMOTORS.NS
- **US**: NVDA (20 shares, up 70%)

### News (10 Articles)
- Mix of earnings, macro, and market news
- Real tickers (NVDA, RELIANCE, TCS, INFY, TSLA)
- Importance levels: Critical, High, Medium

### Events
- Earnings: 8 companies
- Economic: RBI, Fed, US data
- Ratings: 5 analyst calls
- Dividends: 4 upcoming

---

## Development Workflow

### Add a New Feature

1. **Create Types** (`src/types/index.ts`)
   ```typescript
   export interface MyFeature {
     id: string;
     name: string;
   }
   ```

2. **Add to Store** (`src/stores/appStore.ts`)
   ```typescript
   myFeatures: MyFeature[]
   setMyFeatures: (features: MyFeature[]) => void
   ```

3. **Create API Methods** (`src/lib/api.ts`)
   ```typescript
   async getMyFeatures(): Promise<MyFeature[]> {
     const response = await this.client.get('/my-features');
     return response.data.data;
   }
   ```

4. **Build Component** (`src/components/MyFeature.tsx`)
   ```typescript
   export default function MyFeature() {
     const { myFeatures } = useAppStore();
     return <div>...</div>;
   }
   ```

5. **Use in Page** (`src/app/(dashboard)/my-feature/page.tsx`)
   ```typescript
   import MyFeature from '@/components/MyFeature';
   
   export default function MyFeaturePage() {
     return <MyFeature />;
   }
   ```

---

## Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here
```

---

## Build & Deploy

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Deployment Options
- **Vercel**: `git push` (auto-deploys)
- **Docker**: Build with `npm run build`
- **Standalone**: Export static site

---

## Troubleshooting

### Port 3000 Already in Use
```bash
npm run dev -- -p 3001
```

### Tailwind Not Loading
- Ensure `className` (not `class`) is used
- Check `tailwind.config.ts` content paths
- Run `npm install` to rebuild PostCSS

### TypeScript Errors
- Run `npm run lint` to check
- Ensure `@/*` path alias works
- Check `tsconfig.json` paths

---

## Next Steps

1. **Connect Backend**
   - Update `NEXT_PUBLIC_API_URL` in `.env.local`
   - Implement real API endpoints
   - Add authentication flow

2. **Add Real-time**
   - Install `socket.io-client`
   - Create `useWebSocket` hook
   - Connect to market data stream

3. **Build Reusable Components**
   - Extract `NewsCard.tsx`
   - Create `PositionCard.tsx`
   - Build `BriefCard.tsx`

4. **Implement Charts**
   - Install `lightweight-charts` or `recharts`
   - Add candlestick charts to quotes
   - Portfolio allocation pie chart

5. **Add Authentication**
   - Integrate `next-auth`
   - Implement login/signup pages
   - Protect dashboard routes

---

## Resources

- **Next.js**: https://nextjs.org/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **TypeScript**: https://www.typescriptlang.org/docs
- **Zustand**: https://github.com/pmndrs/zustand
- **Axios**: https://axios-http.com/docs/intro

---

**Happy coding! 🚀**
