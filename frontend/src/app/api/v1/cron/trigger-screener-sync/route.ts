// ═══════════════════════════════════════════════════════════════════════════
// THE REFRESH BUTTON DID NOT REFRESH ANYTHING.                       (zzz689)
//
// The Fundamentals page loads its portfolio from a CSV that a GitHub Action
// commits to the repo four times a day. The "Refresh" button next to it
// re-reads THAT FILE. It has never contacted screener.in.
//
// So the failure mode looks like this, and it is entirely silent:
//
//   1. the owner edits "Latest Portfolio" on screener.in — adds Netweb, Uflex,
//      Cyient DLM, drops Skipper, Tata Comm, Sona BLW;
//   2. he opens the portal and sees the OLD list;
//   3. he presses Refresh — which re-reads the same stale committed file and
//      reports success;
//   4. nothing changes, and nothing anywhere says why.
//
// Measured on 2026-09-17: the committed CSV held 57 rows against a watchlist of
// 53, with roughly a dozen names missing and a dozen-and-a-half that had been
// removed. The sync was not broken — `ok: 19, fail: 0` — it was simply 15 hours
// old, and there was no way to ask for a fresh one.
//
// This route is that way. It asks GitHub to run the sync workflow now
// (`workflow_dispatch`), which is the only thing that can actually re-fetch
// from screener.in. The fetch has to happen there, not here, because it needs
// the SCREENER_SESSIONID secret — which lives in GitHub and should stay there.
//
// IT IS HONEST WHEN IT CANNOT HELP. Dispatching a workflow needs a token with
// Actions write permission. If GITHUB_TOKEN is absent or lacks the scope, this
// says so and names the fix, rather than returning a success the page would
// then repeat to the owner. A refresh button that lies is what created this
// problem in the first place.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const OWNER = 'radhevrishi';
const REPO = 'market-cockpit';
const WORKFLOW = 'screener-sync.yml';
const REF = 'main';

async function dispatch() {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) {
    return NextResponse.json({
      ok: false,
      dispatched: false,
      error:
        'No GITHUB_TOKEN is configured on this deployment, so the sync workflow cannot be started from here. ' +
        'The scheduled runs (04:00, 05:30, 08:00 and 12:00 UTC) are unaffected. ' +
        'To enable this button: create a fine-grained token with Actions: Read and write on this repository, ' +
        'then add it to Railway Variables as GITHUB_TOKEN.',
    });
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'market-cockpit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: REF }),
      signal: AbortSignal.timeout(20_000),
    });

    // 204 No Content is success for workflow_dispatch.
    if (r.status === 204) {
      return NextResponse.json({
        ok: true,
        dispatched: true,
        note:
          'A fresh screener.in sync has been requested. It usually takes 1-2 minutes to fetch and commit, ' +
          'and a further minute or so for the deployment to serve the new file — so reload this page in a few minutes.',
      });
    }
    const body = await r.text();
    // 403 with no scope is the common case and deserves its own sentence.
    const hint = r.status === 403
      ? ' The token exists but lacks Actions: Read and write on this repository.'
      : r.status === 404
        ? ' The workflow or repository was not found under this token.'
        : '';
    return NextResponse.json({
      ok: false,
      dispatched: false,
      error: `GitHub refused the request (HTTP ${r.status}).${hint} ${body.slice(0, 200)}`,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      dispatched: false,
      error: `Could not reach GitHub to start the sync (${String(e?.message || e)}).`,
    });
  }
}

export async function POST() { return dispatch(); }
// GET too, so it can be triggered from a browser address bar while debugging.
export async function GET() { return dispatch(); }
