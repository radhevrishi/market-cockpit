// Route UX guardrails: data outages should provide a recovery path, without
// passing stack traces or credentials to browser-visible HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardError from '../../app/(dashboard)/error';
import DashboardRouteLoading from '../../app/(dashboard)/loading';

test('dashboard route error offers a recoverable action without exposing internal messages', () => {
  const error = Object.assign(new Error('SECRET_VALUE_DO_NOT_RENDER'), {
    digest: 'opaque-ref-01',
  });
  const html = renderToStaticMarkup(
    React.createElement(DashboardError, { error, reset: () => {} }),
  );
  assert.match(html, /This view could not load/);
  assert.match(html, /Retry this view/);
  assert.match(html, /Dashboard home/);
  assert.match(html, /opaque-ref-01/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /SECRET_VALUE_DO_NOT_RENDER/);
});

test('dashboard loading state uses neutral placeholders rather than fake investment values', () => {
  const html = renderToStaticMarkup(React.createElement(DashboardRouteLoading));
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading research workspace/);
  assert.match(html, /Financial figures are shown only after/);
  assert.doesNotMatch(html, /₹[\d,]+|\$[\d,]+|\d+% CAGR/);
});
