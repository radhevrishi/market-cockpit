import sys
p = sys.argv[1]
s = open(p).read(); o = s
OLD = """          STATUS=$(curl -s -o /tmp/response.json -w "%{http_code}" -X "$METHOD" \\
            -H 'Content-Type: application/json' \\
            --max-time 240 \\
            "$URL" || echo "000")
          echo "- HTTP $STATUS"
"""
NEW = """          # ── zzz668 — RETRY A 5xx ONCE BEFORE GIVING UP FOR THE DAY ────────
          #
          # hub-ingest sat on a 502 in the health view for forty hours. Timed by
          # hand the same route answered 200 in 36.6 seconds — the failure was
          # transient, Railway not responding while it recovered or rebuilt.
          #
          # These jobs run ONCE A DAY. A transient 5xx therefore costs a whole
          # day of ingestion, and the only evidence left behind is a red row
          # that looks identical to a real breakage. One retry after a pause
          # separates "the app was briefly down" from "this job is broken", and
          # costs nothing on the runs that succeed first time.
          #
          # 4xx is NOT retried: 401, 404 and 405 are answers, not outages, and
          # repeating them would only have hidden the prewarm-us-earnings bug
          # for longer.
          hit_once() {
            curl -s -o /tmp/response.json -w "%{http_code}" -X "$METHOD" \\
              -H 'Content-Type: application/json' \\
              --max-time 240 \\
              "$URL" || echo "000"
          }
          STATUS=$(hit_once)
          if [[ "$STATUS" == 5* || "$STATUS" == "000" ]]; then
            echo "- HTTP $STATUS on the first attempt - waiting 45s and retrying once"
            sleep 45
            STATUS=$(hit_once)
          fi
          echo "- HTTP $STATUS"
"""
assert OLD in s, "anchor not found"
s = s.replace(OLD, NEW, 1)
open(p, 'w').write(s)
print("patched:", s != o)
