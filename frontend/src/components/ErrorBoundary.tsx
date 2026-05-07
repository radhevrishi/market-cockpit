'use client';

import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; context?: string; }
interface State { hasError: boolean; message: string; }

/**
 * Generic React error boundary. Catches any unhandled render error and shows
 * a recovery UI instead of the blank white-screen "Application error" page.
 *
 * Usage:
 *   <ErrorBoundary context="Bottleneck Intel">
 *     <BottleneckIntelPage />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log for debugging — visible in browser console
    console.error(`[ErrorBoundary${this.props.context ? ` · ${this.props.context}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '300px', padding: '40px 20px', textAlign: 'center',
          backgroundColor: '#0A0E1A',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚠️</div>
          <p style={{ fontSize: '15px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 8px' }}>
            {this.props.context ? `${this.props.context} — ` : ''}Something went wrong
          </p>
          <p style={{ fontSize: '12px', color: '#4A5B6C', margin: '0 0 20px', maxWidth: '400px', lineHeight: '1.5' }}>
            {this.state.message || 'An unexpected error occurred. Try refreshing the page.'}
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => { this.setState({ hasError: false, message: '' }); }}
              style={{
                padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                backgroundColor: '#0F7ABF', border: 'none', color: 'white',
                fontSize: '13px', fontWeight: '600',
              }}
            >
              ↻ Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                backgroundColor: 'transparent', border: '1px solid #1E2D45', color: '#8A95A3',
                fontSize: '13px',
              }}
            >
              Reload page
            </button>
          </div>
          <p style={{ fontSize: '10px', color: '#2A3B4C', marginTop: '16px' }}>
            Open browser console (F12) for technical details
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
