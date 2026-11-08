import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("status-only changes cannot refresh the GPS timestamp", () => {
  const route = readFileSync("src/app/api/driver/status/route.ts", "utf8");
  assert.doesNotMatch(route, /last_seen\s*:/);
});

test("secondary offer polling hides busy Drivers and uses stable earliest expiry", () => {
  const route = readFileSync("src/app/api/driver/offers/poll/route.ts", "utf8");
  assert.match(route, /!driver\.online\s*\|\|\s*driver\.busy/);
  assert.match(route, /order\("accept_deadline_at",\s*\{ ascending: true \}\)/);
  assert.match(route, /order\("id",\s*\{ ascending: true \}\)/);
});
