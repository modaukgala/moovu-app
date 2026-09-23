-- READ ONLY / TEST FIXTURE / NOT FOR AUTOMATIC EXECUTION.
-- Produces the Phase 0 wallet projection and legacy-ledger comparison without
-- changing balances or financial history.
select w.driver_id,
  round(coalesce(w.balance_due,0),2) cached_balance,
  round(coalesce(c.gross_commission,0),2) completed_trip_commission,
  round(coalesce(s.settlements,0),2) valid_settlements,
  round(coalesce(x.credits,0),2) cancellation_no_show_credits,
  round(greatest(0,coalesce(c.gross_commission,0)-coalesce(s.settlements,0)-coalesce(x.credits,0)),2) expected_balance,
  round(coalesce(l.ledger_commission,0),2) legacy_commission_ledger,
  round(coalesce(w.balance_due,0)-greatest(0,coalesce(c.gross_commission,0)-coalesce(s.settlements,0)-coalesce(x.credits,0)),2) projection_difference
from public.driver_wallets w
left join lateral (select sum(t.commission_amount) gross_commission from public.trips t where t.driver_id=w.driver_id and t.status='completed') c on true
left join lateral (select sum(s.amount_paid) settlements from public.driver_settlements s where s.driver_id=w.driver_id) s on true
left join lateral (select sum(t.amount) credits from public.driver_wallet_transactions t where t.driver_id=w.driver_id and t.tx_type='cancellation_credit' and t.direction='credit') x on true
left join lateral (select sum(t.amount) ledger_commission from public.driver_wallet_transactions t where t.driver_id=w.driver_id and t.tx_type='commission' and t.direction='debit') l on true
order by w.driver_id;
