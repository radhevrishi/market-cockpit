# Market Cockpit Frontend - Installation & Setup Checklist

## Pre-Installation Requirements

- [ ] Node.js 18+ installed
- [ ] npm or yarn package manager
- [ ] Git for version control
- [ ] Code editor (VS Code recommended)

---

## Installation Steps

### 1. Install Dependencies
```bash
cd /sessions/cool-quirky-mayer/market-cockpit/frontend
npm install
```

**What this installs:**
- Next.js 14.2.5 framework
- React 18.3.1 UI library
- TypeScript 5.5.3 for type safety
- Tailwind CSS 3.4.7 for styling
- Zustand 4.5.4 for state management
- Axios 1.7.2 for API calls
- Socket.io-client 4.7.5 (ready for real-time)
- And 15+ other supporting libraries

### 2. Create Environment File
```bash
cp .env.example .env.local
```

Then edit `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here
```

### 3. Start Development Server
```bash
npm run dev
```

**Expected output:**
```
> next dev

  ▲ Next.js 14.2.5
  - Local:        http://localhost:3000
  - Environments: .env.local

✓ Ready in 2.5s
```

### 4. Open in Browser
Visit: **http://localhost:3000**

You should see the Market Cockpit dashboard with:
- Sidebar navigation on the left
- Global markets ticker at the top
- Mission Control dashboard with sample data

---

## Verification Checklist

### Initial Load (All should be visible)
- [ ] Sidebar with 7 navigation items
- [ ] Top header with "MARKET COCKPIT" branding
- [ ] Global markets ticker (NIFTY50, SENSEX, S&P500, NASDAQ, USDINR, GOLD)
- [ ] Portfolio summary cards (4 cards with values)
- [ ] Portfolio heatmap (6 colored position tiles)
- [ ] Today's Events section
- [ ] Top Gainers/Losers sections
- [ ] Must Know headlines section

### Navigation (All links should work)
- [ ] Click "Mission Control" - loads mission control page
- [ ] Click "News" - loads news feed page
- [ ] Click "Calendars" - loads calendar page
- [ ] Click "Portfolios" - loads portfolio management page
- [ ] Click "AI Desk" - loads AI briefs & chat page
- [ ] Click "Themes" - loads placeholder page
- [ ] Click "Settings" - loads placeholder page

### Dark Mode (Should be active)
- [ ] Background is dark navy (#0A0E27)
- [ ] Text is light (#F5F7FA)
- [ ] Cards have dark background (#111B35)
- [ ] Accent colors are blue (#0F7ABF) and teal (#06B6D4)

### Responsive Design (Test on different screen sizes)
- [ ] On desktop (1920px): Full layout with sidebar and content
- [ ] On tablet (768px): Sidebar collapsible, content responsive
- [ ] On mobile (375px): Hamburger menu appears, full-width content

### Interactive Elements
- [ ] Hover over cards - they change background color
- [ ] Click hamburger menu on mobile - sidebar slides in
- [ ] Click user avatar - dropdown menu appears
- [ ] Search in News page - filters articles in real-time
- [ ] Filter buttons in News page - filter articles
- [ ] Tab switching in Calendars - tabs change content
- [ ] Tab switching in Portfolios - portfolio tabs change
- [ ] Tab switching in AI Desk - briefs and chat switch

---

## Build & Production

### Build for Production
```bash
npm run build
```

**Expected output:**
```
> next build

Creating an optimized production build...
Compiled client and server successfully
```

### Start Production Server
```bash
npm start
```

Visit: **http://localhost:3000** (production build)

---

## Troubleshooting

### Issue: Port 3000 Already in Use
**Solution:**
```bash
npm run dev -- -p 3001
# OR
lsof -i :3000  # Find what's using port 3000
kill -9 <PID>  # Kill the process
```

### Issue: Tailwind CSS Not Applied
**Solution:**
- Ensure all classes use `className` (not `class`)
- Check `tailwind.config.ts` has correct content paths
- Run `npm install` again
- Delete `.next` folder and rebuild

### Issue: TypeScript Errors in VS Code
**Solution:**
```bash
npm run lint
# Check tsconfig.json settings
# Restart VS Code TypeScript server
```

### Issue: Module Not Found Errors
**Solution:**
- Clear node_modules: `rm -rf node_modules && npm install`
- Check path aliases in `tsconfig.json` (@/* = ./src/*)
- Ensure imports use correct path format

### Issue: API Calls Failing
**Solution:**
- Verify `NEXT_PUBLIC_API_URL` in `.env.local`
- Check backend server is running
- Mock data will display if backend is unavailable
- Check browser console for specific error messages

---

## Next Steps After Setup

### 1. Explore the Codebase
- [ ] Review `README.md` for project overview
- [ ] Read `FILE_MANIFEST.md` for architecture details
- [ ] Read `GETTING_STARTED.md` for development guide
- [ ] Browse `src/types/index.ts` to understand data structures
- [ ] Review `src/stores/appStore.ts` for state management
- [ ] Check `src/lib/api.ts` for API integration pattern

### 2. Connect Your Backend
- [ ] Update `NEXT_PUBLIC_API_URL` to point to your API
- [ ] Implement real API endpoints (see `src/lib/api.ts`)
- [ ] Replace mock data with real API calls
- [ ] Test API integration with actual backend

### 3. Implement Authentication
- [ ] Set up next-auth configuration
- [ ] Create login/signup pages
- [ ] Implement JWT token management
- [ ] Add protected routes

### 4. Build Reusable Components
- [ ] Extract NewsCard.tsx from news/page.tsx
- [ ] Extract PositionCard.tsx from portfolios/page.tsx
- [ ] Create BriefCard.tsx for AI Desk
- [ ] Create FilterPanel.tsx components
- [ ] Add index.ts barrel exports

### 5. Add Real-time Features
- [ ] Implement Socket.io connection for live quotes
- [ ] Create useWebSocket custom hook
- [ ] Update market ticker with real prices
- [ ] Add live P&L updates

### 6. Implement Advanced Features
- [ ] Add chart components (Lightweight Charts or Recharts)
- [ ] Implement watchlist management
- [ ] Add alert rules builder
- [ ] Create custom dashboard builder
- [ ] Add export to PDF/Excel functionality

---

## Development Best Practices

### File Organization
```
✓ Keep pages in (dashboard)/ group
✓ Create reusable components in src/components/
✓ Add custom hooks in src/hooks/
✓ Keep types in src/types/index.ts
✓ Keep API methods in src/lib/api.ts
✓ Keep global state in src/stores/appStore.ts
```

### Code Quality
```
✓ Use TypeScript strict mode (enabled by default)
✓ Follow Tailwind utility-first approach
✓ Use Zustand for global state only
✓ Keep components under 300 lines
✓ Export components from index files
✓ Document complex logic with comments
```

### Performance
```
✓ Use Next.js Image component for images
✓ Implement code splitting for routes
✓ Lazy load heavy components
✓ Cache API responses when appropriate
✓ Optimize Tailwind build size
```

### Testing Ready
```
✓ Mock data patterns for unit tests
✓ Typed API responses for integration tests
✓ Component structure for snapshot tests
✓ Zustand store for state tests
```

---

## Deployment Options

### Vercel (Recommended for Next.js)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Docker
```bash
# Build Docker image
docker build -t market-cockpit .

# Run container
docker run -p 3000:3000 market-cockpit
```

### Standard Server
```bash
# Build
npm run build

# Upload 'src' and '.next' directories to server
# Install Node.js on server
# Run: npm start
```

---

## Performance Monitoring

### Build Size
```bash
npm run build
# Check .next directory size
du -sh .next/
```

**Expected**: ~5-10 MB

### Runtime Performance
- Use browser DevTools (F12)
- Check Network tab for load times
- Monitor Console for warnings
- Use Lighthouse for scoring

---

## Security Checklist

- [ ] Never commit `.env.local` to git
- [ ] Keep dependencies updated: `npm outdated`
- [ ] Run security audit: `npm audit`
- [ ] Use HTTPS in production
- [ ] Implement rate limiting on API
- [ ] Validate all user inputs
- [ ] Use CORS appropriately
- [ ] Rotate JWT secrets regularly

---

## Version Control

### Git Setup
```bash
git init
git add .
git commit -m "Initial commit: Market Cockpit frontend scaffold"
git remote add origin <your-repo>
git push -u origin main
```

### Recommended .gitignore additions
```
node_modules/
.next/
dist/
.env.local
.env.*.local
.vercel
```

---

## Support & Resources

### Official Documentation
- **Next.js**: https://nextjs.org/docs
- **React**: https://react.dev
- **TypeScript**: https://www.typescriptlang.org/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Zustand**: https://github.com/pmndrs/zustand
- **Axios**: https://axios-http.com/docs

### Community
- **Next.js Discord**: https://discord.gg/nextjs
- **Tailwind Discord**: https://discord.gg/tailwindcss
- **Stack Overflow**: Tag with [next.js] and [typescript]

---

## Quick Commands Reference

```bash
# Development
npm run dev              # Start dev server on http://localhost:3000

# Building
npm run build            # Build for production
npm start                # Start production server

# Code Quality
npm run lint             # Run ESLint

# Maintenance
npm outdated             # Check for outdated packages
npm update               # Update packages
npm audit                # Check for security issues
npm install              # Install all dependencies
```

---

## Success Indicators

✅ **You've successfully set up if:**

1. `npm install` completes without errors
2. `npm run dev` starts server on http://localhost:3000
3. Browser shows dark-themed dashboard with mock data
4. All navigation links work
5. Portfolio heatmap displays with color coding
6. News feed shows 10 articles with filters
7. Calendar tabs switch between earnings/economic/ratings/dividends
8. Portfolio table displays 5 positions with P&L
9. AI Desk shows morning brief and chat interface
10. Mobile hamburger menu works on smaller screens

---

## Getting Help

If you encounter issues:

1. **Check console**: `F12` → Console tab for error messages
2. **Check docs**: Review README.md and GETTING_STARTED.md
3. **Check node**: Ensure Node.js 18+ is installed
4. **Clear cache**: Delete `.next` folder and rebuild
5. **Reinstall**: Delete `node_modules` and run `npm install`

---

## Congratulations! 🎉

Your Market Cockpit frontend is ready for development.

**Next**: Connect your backend API and start building features!

---

**Setup Date**: March 1, 2026  
**Last Updated**: March 1, 2026  
**Status**: ✅ Ready for Development
