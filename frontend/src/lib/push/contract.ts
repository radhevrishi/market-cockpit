// zzz1063 — PHONE / BROWSER PUSH: the contract between the server (lib/push/server.ts, app/api/v1/push) and the client
// (service worker public/sw.js + the subscribe button, built separately). Pure — safe to import in the browser.
//
// ROUTES (owner-only: login cookie or service key, like /api/v1/price-alerts — lib/site-auth PROTECTED_API_PREFIXES)
//   GET  /api/v1/push?view=key      → { ok, publicKey }            VAPID public key (base64url) for pushManager.subscribe
//                                                                   ({ userVisibleOnly: true, applicationServerKey: publicKey })
//   GET  /api/v1/push?view=devices  → { ok, devices: PushDevice[] } the saved browsers / phones (endpoint shown shortened)
//   POST /api/v1/push { action: 'subscribe', subscription: PushSubscriptionJSON, label?: string, replaces?: string }
//                                   → { ok, device }               saves (or re-enables) this browser; label e.g. "iPhone".
//                                                                   `replaces` = the OLD endpoint (service worker
//                                                                   pushsubscriptionchange): that row is swapped for the new one
//   POST /api/v1/push { action: 'unsubscribe', endpoint }        → { ok, removed }
//   POST /api/v1/push { action: 'test' }                          → { ok, results: PushDeviceResult[], sent, failed, line }
//                                                                   one test push to every saved device; per device
//                                                                   state 'sent' | 'gone' (404 / 410: disabled) | 'error'
//
// PAYLOAD (the JSON text of each push message; the service worker shows it with showNotification(title, { body, tag, data }))
//   { title, body, url, tag, eventId }
//     url      — where a tap should open: '/price-alerts?event=<id>' for one alert, '/price-alerts' for several
//     tag      — notifications with the same tag replace each other ('mc-alert-<id>', 'mc-alerts', 'mc-push-test')
//     eventId  — the price-alert event id (number) for one alert, null for a summary / test
//
// Delivery: every fired price alert whose alert has push on (notify.push, missing = on) gets one outbox row for 'push'
// (lib/alerts/delivery.ts). Several due events are grouped into ONE push per device. A device whose push service answers
// 404 / 410 (subscription gone) is disabled and no longer sent to; it is enabled again when the browser subscribes again.

export interface PushPayload { title: string; body: string; url: string; tag: string; eventId: number | null }
export interface PushDevice { id: number; label: string | null; endpointShort: string; createdAt: string; lastOkAt: string | null; lastError: string | null; disabled: boolean }
export interface PushDeviceResult { id: number; label: string | null; endpointShort: string; ok: boolean; state: 'sent' | 'gone' | 'error'; status: number | null; error: string | null; disabled: boolean }

export const PUSH_API = '/api/v1/push';
