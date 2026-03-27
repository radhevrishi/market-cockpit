/**
 * Axios instance for all API calls.
 *
 * Uses Next.js rewrite proxy: all requests go to /api/v1/* on the same origin,
 * which Next.js forwards to the FastAPI backend at 127.0.0.1:8000.
 * This avoids CORS and localhost IPv4/IPv6 issues.
 */
import axios from 'axios';

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

// ── Response interceptor: redirect to /login on 401 ─────────────────────────
let _redirecting = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined' && !_redirecting) {
      _redirecting = true;
      localStorage.removeItem('token');
      window.location.href = '/login';
      // Reject with a specific error so React Query exits loading state cleanly
      const authError = new Error('Authentication required — redirecting to login');
      (authError as any).isAuthRedirect = true;
      return Promise.reject(authError);
    }
    return Promise.reject(error);
  },
);

export default api;
