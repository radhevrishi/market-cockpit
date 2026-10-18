// zzz1063 — the web-push package ships no types; lib/push/server.ts uses generateVAPIDKeys and sendNotification only.
declare module 'web-push';
