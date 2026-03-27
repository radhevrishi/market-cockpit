import { create } from 'zustand';
import { UserProfile, Portfolio, NewsArticle, NewsFilter, AlertInstance } from '@/types';

interface AppState {
  // User state
  user: UserProfile | null;
  authToken: string | null;
  isAuthenticated: boolean;

  // Portfolio state
  portfolios: Portfolio[];
  activePortfolioId: string | null;
  activePortfolio: Portfolio | null;

  // News state
  newsArticles: NewsArticle[];
  newsFilter: NewsFilter;
  newsLoading: boolean;
  searchQuery: string;

  // Alerts state
  alerts: AlertInstance[];
  unreadAlertCount: number;

  // UI state
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  globalLoadingState: boolean;
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
  }>;

  // Actions - User
  setUser: (user: UserProfile | null) => void;
  setAuthToken: (token: string | null) => void;
  clearAuth: () => void;

  // Actions - Portfolio
  setPortfolios: (portfolios: Portfolio[]) => void;
  setActivePortfolio: (portfolioId: string) => void;
  addPortfolio: (portfolio: Portfolio) => void;
  updatePortfolio: (portfolio: Portfolio) => void;

  // Actions - News
  setNewsArticles: (articles: NewsArticle[]) => void;
  addNewsArticles: (articles: NewsArticle[]) => void;
  setNewsFilter: (filter: Partial<NewsFilter>) => void;
  setSearchQuery: (query: string) => void;
  setNewsLoading: (loading: boolean) => void;
  resetNewsFilter: () => void;

  // Actions - Alerts
  setAlerts: (alerts: AlertInstance[]) => void;
  addAlert: (alert: AlertInstance) => void;
  removeAlert: (alertId: string) => void;
  markAlertAsRead: (alertId: string) => void;
  clearAllAlerts: () => void;

  // Actions - UI
  setTheme: (theme: 'dark' | 'light') => void;
  toggleSidebar: () => void;
  setGlobalLoading: (loading: boolean) => void;
  addNotification: (notification: Omit<AppState['notifications'][0], 'id'>) => void;
  removeNotification: (notificationId: string) => void;
}

const defaultNewsFilter: NewsFilter = {
  markets: ['india', 'us', 'global'],
  sectors: [],
  themes: [],
  importanceLevel: ['critical', 'high', 'medium', 'low'],
  timeRange: 'last-day',
  search: '',
};

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  user: null,
  authToken: typeof window !== 'undefined' ? localStorage.getItem('authToken') : null,
  isAuthenticated: false,

  portfolios: [],
  activePortfolioId: null,
  activePortfolio: null,

  newsArticles: [],
  newsFilter: defaultNewsFilter,
  newsLoading: false,
  searchQuery: '',

  alerts: [],
  unreadAlertCount: 0,

  theme: 'dark',
  sidebarCollapsed: false,
  globalLoadingState: false,
  notifications: [],

  // User actions
  setUser: (user) =>
    set((state) => ({
      user,
      isAuthenticated: !!user,
    })),

  setAuthToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('authToken', token);
      } else {
        localStorage.removeItem('authToken');
      }
    }
    set({ authToken: token });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken');
    }
    set({
      user: null,
      authToken: null,
      isAuthenticated: false,
      portfolios: [],
      activePortfolioId: null,
      activePortfolio: null,
    });
  },

  // Portfolio actions
  setPortfolios: (portfolios) => set({ portfolios }),

  setActivePortfolio: (portfolioId) =>
    set((state) => {
      const portfolio = state.portfolios.find((p) => p.id === portfolioId);
      return {
        activePortfolioId: portfolioId,
        activePortfolio: portfolio || null,
      };
    }),

  addPortfolio: (portfolio) =>
    set((state) => ({
      portfolios: [...state.portfolios, portfolio],
    })),

  updatePortfolio: (portfolio) =>
    set((state) => ({
      portfolios: state.portfolios.map((p) => (p.id === portfolio.id ? portfolio : p)),
      activePortfolio:
        state.activePortfolio?.id === portfolio.id ? portfolio : state.activePortfolio,
    })),

  // News actions
  setNewsArticles: (articles) => set({ newsArticles: articles }),

  addNewsArticles: (articles) =>
    set((state) => ({
      newsArticles: [...state.newsArticles, ...articles],
    })),

  setNewsFilter: (filter) =>
    set((state) => ({
      newsFilter: { ...state.newsFilter, ...filter },
    })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setNewsLoading: (loading) => set({ newsLoading: loading }),

  resetNewsFilter: () =>
    set({
      newsFilter: defaultNewsFilter,
      searchQuery: '',
    }),

  // Alerts actions
  setAlerts: (alerts) =>
    set({
      alerts,
      unreadAlertCount: alerts.filter((a) => !a.read).length,
    }),

  addAlert: (alert) =>
    set((state) => {
      const newAlerts = [alert, ...state.alerts];
      return {
        alerts: newAlerts,
        unreadAlertCount: newAlerts.filter((a) => !a.read).length,
      };
    }),

  removeAlert: (alertId) =>
    set((state) => {
      const newAlerts = state.alerts.filter((a) => a.id !== alertId);
      return {
        alerts: newAlerts,
        unreadAlertCount: newAlerts.filter((a) => !a.read).length,
      };
    }),

  markAlertAsRead: (alertId) =>
    set((state) => {
      const newAlerts = state.alerts.map((a) =>
        a.id === alertId ? { ...a, read: true } : a
      );
      return {
        alerts: newAlerts,
        unreadAlertCount: newAlerts.filter((a) => !a.read).length,
      };
    }),

  clearAllAlerts: () =>
    set({
      alerts: [],
      unreadAlertCount: 0,
    }),

  // UI actions
  setTheme: (theme) => set({ theme }),

  toggleSidebar: () =>
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
    })),

  setGlobalLoading: (loading) => set({ globalLoadingState: loading }),

  addNotification: (notification) =>
    set((state) => {
      const id = Math.random().toString(36).substring(2, 11);
      return {
        notifications: [...state.notifications, { ...notification, id }],
      };
    }),

  removeNotification: (notificationId) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== notificationId),
    })),
}));
