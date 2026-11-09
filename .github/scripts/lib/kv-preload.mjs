// zzz1230 — loaded with `node --import ./.github/scripts/lib/kv-preload.mjs <script>` by the collector workflows: before the
// script reads its env, point UPSTASH_REDIS_REST_URL at the app's Postgres-backed relay when the app answers (see kv-target).
import { applyKvTarget } from './kv-target.mjs';
await applyKvTarget(process.env);
