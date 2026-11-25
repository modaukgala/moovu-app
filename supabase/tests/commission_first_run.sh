#!/usr/bin/env bash
# Requires a manually verified disposable local database over a Unix socket.
set -euo pipefail

scenario=${1:?Choose allocation, same-trip, settlement, manual-race, same-driver, different-driver, combined, accrual or cancellation}
: "${FIN04_SOCKET:?Set the verified local Unix socket directory}"
: "${FIN04_DATABASE:?Set the disposable database name}"
: "${FIN04_GLOBAL_ROLE:?Set the local database owner role}"
: "${FIN04_PORT:?Set the isolated cluster port}"
: "${FIN04_ISOLATED_ACK:?Set to the exact verified database name}"
if [[ "$FIN04_SOCKET" != /* || ! -d "$FIN04_SOCKET" ||
      ! "$FIN04_DATABASE" =~ ^fin04_disposable_[a-z0-9_]+$ ||
      "$FIN04_ISOLATED_ACK" != "$FIN04_DATABASE" ]]; then
  echo 'Refusing an unverified or non-disposable target' >&2
  exit 2
fi
cd -- "$(dirname -- "$0")"
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGPASSWORD PGPASSFILE
export PGPASSFILE=/dev/null
db=(psql -X -w -h "$FIN04_SOCKET" -p "$FIN04_PORT" -U "$FIN04_GLOBAL_ROLE" -d "$FIN04_DATABASE" -v ON_ERROR_STOP=1)
identity=$("${db[@]}" -Atc "select current_database() || ':' || (inet_server_addr() is null)")
[[ "$identity" = "$FIN04_DATABASE:true" ]] || { echo "Unexpected database identity $identity" >&2; exit 2; }

tmp=$(mktemp -d)
session_a=
trap 'if [[ -n "$session_a" ]]; then kill "$session_a" 2>/dev/null || true; fi; rm -f "$tmp/a.log"; rmdir "$tmp"' EXIT

if [[ "$scenario" == allocation ]]; then
  fixture=$("${db[@]}" -qAt -F '|' -f commission_first_fixture.sql -f commission_first_allocation_edges.sql -f commission_first_zero_net.sql)
else
  case "$scenario" in
    same-trip|settlement|manual-race)
      fixture=$("${db[@]}" -qAt -F '|' -f commission_first_fixture.sql)
      ;;
    same-driver|different-driver|combined|accrual|cancellation)
      fixture=$("${db[@]}" -qAt -F '|' -v scenario="$scenario" -f commission_first_fixture.sql -f commission_first_race_fixture.sql)
      ;;
    *) echo "Unknown scenario $scenario" >&2; exit 2 ;;
  esac
fi
row=$(printf '%s\n' "$fixture" | tail -1)
if [[ "$scenario" == allocation || "$scenario" == same-trip || "$scenario" == settlement || "$scenario" == manual-race ]]; then
  IFS='|' read -r actor reviewer support driver_user customer driver trip payment <<< "$row"
else
  IFS='|' read -r actor support customer driver trip competitor competitor_driver <<< "$row"
fi
args=(-v actor_id="$actor" -v trip_id="$trip" -v driver_id="$driver")

if [[ "$scenario" == allocation ]]; then
  "${db[@]}" "${args[@]}" -v reviewer_id="$reviewer" -v support_id="$support" -v driver_user_id="$driver_user" \
    -f commission_first_allocation.sql -f commission_first_manual_payments.sql -f commission_first_security.sql
  exit
fi

if [[ "$scenario" == manual-race ]]; then
  "${db[@]}" "${args[@]}" -v first_session=true -f commission_first_manual_concurrency.sql >"$tmp/a.log" 2>&1 &
else
  "${db[@]}" "${args[@]}" -f commission_first_concurrency_a.sql >"$tmp/a.log" 2>&1 &
fi
session_a=$!
for ((attempt=0; attempt<100; attempt++)); do
  if grep -q '^FIN04_A_READY$' "$tmp/a.log"; then break; fi
  if ! kill -0 "$session_a" 2>/dev/null; then cat "$tmp/a.log" >&2; wait "$session_a"; exit 1; fi
  sleep 0.1
done
grep -q '^FIN04_A_READY$' "$tmp/a.log" || { cat "$tmp/a.log" >&2; exit 1; }

case "$scenario" in
  same-trip) "${db[@]}" "${args[@]}" -f commission_first_concurrency_b.sql ;;
  settlement) "${db[@]}" "${args[@]}" -f commission_first_competing_settlement.sql ;;
  manual-race) "${db[@]}" "${args[@]}" -v first_session=false -f commission_first_manual_concurrency.sql ;;
  *)
    independent=false
    if [[ "$scenario" == different-driver ]]; then independent=true; fi
    "${db[@]}" "${args[@]}" -v scenario="$scenario" -v independent="$independent" \
      -v competitor_id="$competitor" -v competitor_driver="$competitor_driver" \
      -v customer_actor="$support" -v customer_id="$customer" -v commission_pct=15 \
      -f commission_first_race_b.sql
    ;;
esac
wait "$session_a"
session_a=
cat "$tmp/a.log"
