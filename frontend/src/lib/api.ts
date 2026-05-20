/**
 * Axios instance for all API calls.
 *
 * Uses Next.js rewrite proxy: all requests go to /api/v1/* on the same origin,
 * which Next.js forwards to the FastAPI backend at 127.0.0.1:8000.
 * This avoids CORS and localhost IPv4/IPv6 issues.
 *
 * PATCH 0543 — Render outage hardening. The upstream `market-cockpit-api`
 * Render service has exited with status 3 several times mid-session. We now
 * retry 5xx + network errors twice (1s + 2s exponential backoff) before
 * surfacing the error to the caller, and dispatch a `mc:backend-recovering`
 * window event the toast layer subscribes to so users see a transient
 * "Backend recovering — retrying..." hint instead of a stack trace.
 */
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ── Request interceptor: attach JWT ──────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// PATCH 0543 — graceful 5xx + network retry helper.
type RetryConfig = AxiosRequestConfig & { __retryCount?: number };
const MAX_RETRIES = 2;
const BACKOFF_MS = (attempt: number) => 1000 * attempt; // 1s, 2s

const notifyRecovering = () => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('mc:backend-recovering', {
      detail: { ts: Date.now() },
    }));
  } catch {}
};

const shouldRetry = (error: AxiosError) => {
  if (!error) return false;
  // Network error / abort without a response — Render cold-start / 502 chain.
  if (!error.response) return error.code !== 'ECONNABORTED';
  const status = error.response.status;
  // 5xx == upstream out, 429 == temporary rate-limit. Retry both.
  return status >= 500 || status === 429;
};

// ── Response interceptor: redirect to /login on 401 + retry on 5xx ─────────
let _redirecting = false;
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== 'undefined' && !_redirecting) {
      _redirecting = true;
      localStorage.removeItem('token');
      window.location.href = '/login';
      const authError = new Error('Authentication required — redirecting to login');
      (authError as any).isAuthRedirect = true;
      return Promise.reject(authError);
    }

    const cfg: RetryConfig | undefined = error.config as RetryConfig | undefined;
    if (cfg && shouldRetry(error)) {
      const retryCount = (cfg.__retryCount ?? 0) + 1;
      if (retryCount <= MAX_RETRIES) {
        cfg.__retryCount = retryCount;
        // First retry — surface a soft toast.
        if (retryCount === 1) notifyRecovering();
        await new Promise((r) => setTimeout(r, BACKOFF_MS(retryCount)));
        return api(cfg);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
