import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("docs/phase-5-booking-defaults-fix.sql", "utf8");
const route = readFileSync("src/app/api/customer/book-trip/route.ts", "utf8");

test("Booking repair is narrowly scoped, guarded and preserves constraints", () => {
  assert.match(migration, /phase5_create_trip\(uuid,uuid,text,jsonb,bigint,text,bigint\)/);
  assert.match(migration, /atttypid='uuid\[\]'::regtype and attnotnull/);
  assert.match(migration, /expected exactly one original INSERT/);
  assert.match(migration, /already installed/);
  assert.doesNotMatch(migration, /drop\s+(?:constraint|not null)|truncate|delete from|update public\.trips|alter table/i);
});

test("Repaired INSERT names supplied columns and binds JSON instead of interpolating values", () => {
  const replacement = migration.split("$replacement$")[1];
  assert.match(replacement, /insert into public\.trips \(%s\) select %s/);
  assert.match(replacement, /format\('%I',a\.attname\)/);
  assert.match(replacement, /p_trip_payload \? a\.attname/);
  assert.match(replacement, /jsonb_populate_record\(null::public\.trips,\$1\)/);
  assert.match(replacement, /into created using p_trip_payload/);
  assert.match(replacement, /a\.attgenerated='' and a\.attidentity=''/);
  assert.doesNotMatch(replacement, /select \(jsonb_populate_record[^;]+\)\.\*/);
});

test("New attempted-driver arrays are empty and explicit JSON null is normalized", () => {
  assert.match(route, /offer_attempted_driver_ids: \[\]/);
  assert.match(migration, /nullif\(p_trip_payload->'offer_attempted_driver_ids','null'::jsonb\),'\[\]'::jsonb\)/);
});

test("Customer booking errors are safe while internal diagnostics remain server-side", () => {
  assert.match(route, /console\.error\("\[book-trip\] trip creation failed"/);
  assert.match(route, /We couldn't create your trip\. Please try again\./);
  assert.doesNotMatch(route, /error: tripErr\?\.message|error: message/);
  assert.match(route, /code: "PHASE4_BOOKING_BLOCKED"/);
  assert.match(route, /code: "PHASE5_QUOTE_CHANGED"/);
});
