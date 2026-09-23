import assert from "node:assert/strict";
import test from "node:test";
const { isFinancialAdminRole } = await import(new URL("./admin.ts", import.meta.url).href);

test("only owner and admin pass the financial HTTP role gate", () => {
  assert.equal(isFinancialAdminRole("owner"), true);
  assert.equal(isFinancialAdminRole("admin"), true);
  assert.equal(isFinancialAdminRole("dispatcher"), false);
  assert.equal(isFinancialAdminRole("support"), false);
  assert.equal(isFinancialAdminRole("driver"), false);
  assert.equal(isFinancialAdminRole("customer"), false);
});
