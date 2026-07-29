import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { buildCompletionAuditFields, completionSchemaSelect, missingCompletionColumn } from "./completionContract.ts";

test("admin completion uses admin audit fields without requiring driver bypass columns", () => {
  const select = completionSchemaSelect("admin");
  assert.match(select, /admin_completion_reason/);
  assert.match(select, /admin_completion_note/);
  assert.doesNotMatch(select, /completed_without_end_otp/);
  assert.doesNotMatch(select, /end_otp_bypass_reason/);

  assert.deepEqual(
    buildCompletionAuditFields({
      mode: "admin",
      actorId: "admin-user",
      now: "2026-07-25T12:00:00.000Z",
      note: "Driver device failed after the trip ended.",
    }),
    {
      completed_by: "admin",
      end_otp_verified: false,
      admin_completion_reason: "Admin override",
      admin_completion_note: "Driver device failed after the trip ended.",
    },
  );
});

test("driver End OTP bypass keeps its dedicated audit contract", () => {
  const select = completionSchemaSelect("bypass");
  assert.match(select, /completed_without_end_otp/);
  assert.match(select, /end_otp_bypass_reason/);
  assert.doesNotMatch(select, /admin_completion_reason/);

  assert.deepEqual(
    buildCompletionAuditFields({
      mode: "bypass",
      actorId: "driver-user",
      now: "2026-07-25T12:00:00.000Z",
      reason: "Connectivity issue",
      note: "Customer could not open the code.",
    }),
    {
      completed_by: "driver",
      end_otp_verified: false,
      completed_without_end_otp: true,
      end_otp_bypass_reason: "Connectivity issue",
      end_otp_bypass_note: "Customer could not open the code.",
      end_otp_bypassed_by: "driver-user",
      end_otp_bypassed_at: "2026-07-25T12:00:00.000Z",
    },
  );
});

test("completion schema detection recognizes PostgREST missing-column errors", () => {
  assert.equal(
    missingCompletionColumn({
      code: "PGRST204",
      message: "Could not find the 'admin_completion_note' column in the schema cache",
    }),
    true,
  );
  assert.equal(
    missingCompletionColumn({ code: "23514", message: "check constraint failed" }),
    false,
  );
});
