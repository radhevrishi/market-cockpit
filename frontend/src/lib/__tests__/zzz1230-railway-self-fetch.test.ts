import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railwaySelfFetch } from '../railway-self-fetch';

test('Railway internal requests prefer loopback; external hosts stay external', async () => {
  const beforeFetch = globalThis.fetch;
  const beforePort = process.env.PORT;
  const beforeAuthUrl = process.env.NEXTAUTH_URL;
  const calls: string[] = [];
  try {
    process.env.PORT = '8080';
    process.env.NEXTAUTH_URL = 'https://market-cockpit-production.up.railway.app';
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ ok: true });
    }) as typeof fetch;

    const internal = await railwaySelfFetch('https://market-cockpit-production.up.railway.app/api/v1/news?limit=8');
    assert.equal(internal.status, 200);
    assert.equal(calls[0], 'http://127.0.0.1:8080/api/v1/news?limit=8');

    await railwaySelfFetch('https://example.org/market-data');
    assert.equal(calls[1], 'https://example.org/market-data');
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforePort === undefined) delete process.env.PORT; else process.env.PORT = beforePort;
    if (beforeAuthUrl === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = beforeAuthUrl;
  }
});

test('aborted internal requests never retry at the public edge', async () => {
  const beforeFetch = globalThis.fetch;
  const beforePort = process.env.PORT;
  try {
    process.env.PORT = '8080';
    const calls: string[] = [];
    const abort = new AbortController();
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      abort.abort();
      throw new Error('request aborted');
    }) as typeof fetch;
    await assert.rejects(railwaySelfFetch('https://market-cockpit-production.up.railway.app/api/v1/news', { signal: abort.signal }), /request aborted/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforePort === undefined) delete process.env.PORT; else process.env.PORT = beforePort;
  }
});
