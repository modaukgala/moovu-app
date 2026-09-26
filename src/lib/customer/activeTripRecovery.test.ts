import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error Native Node test runner requires the TypeScript extension.
import { CUSTOMER_ACTIVE_STATUSES, customerResumeDestination, isCustomerRecoveryEntry } from './activeTripRecovery.ts';
test('only customer home and booking are recovery entries',()=>{
  assert.ok(isCustomerRecoveryEntry('/'));assert.ok(isCustomerRecoveryEntry('/book'));
  for(const path of ['/ride/a','/ride/a/receipt','/ride/a/rate','/payment/success','/payment/cancel','/payment/failure','/customer/auth','/account/delete','/privacy-policy','/shared-trip/a','/driver','/admin'])assert.equal(isCustomerRecoveryEntry(path),false,path);
});
test('existing active states exclude completed cancelled and future scheduled trips',()=>{
  assert.deepEqual(CUSTOMER_ACTIVE_STATUSES,['requested','offered','assigned','arrived','ongoing']);
  for(const terminal of ['completed','cancelled','scheduled'])assert.equal((CUSTOMER_ACTIVE_STATUSES as readonly string[]).includes(terminal),false);
});
test('cash and verified online resume same trip; unpaid online preserves payment gate',()=>{
  assert.equal(customerResumeDestination({id:'a',payment_method:'cash'},false),'/ride/a');
  assert.equal(customerResumeDestination({id:'a',payment_method:'online'},true),'/ride/a');
  assert.equal(customerResumeDestination({id:'a',payment_method:'online'},false),'/payment/success?tripId=a');
});
test('resolver binds customer to verified session and never mutates trip/payment/profile',()=>{
  const route=readFileSync('src/app/api/customer/active-trip/route.ts','utf8');
  assert.match(route,/auth\.getUser\(\)/);assert.match(route,/\.eq\('auth_user_id',user.id\)/);
  assert.match(route,/\.eq\('customer_id',customer.id\)/);assert.match(route,/order\('id',\{ascending:false\}\)/);
  assert.doesNotMatch(route,/\.(insert|update|delete|upsert|rpc)\(/);assert.doesNotMatch(route,/getAuthenticatedCustomer/);
  assert.match(route,/private, no-store/);
});
