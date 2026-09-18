-- Append-only enforcement for ledger_entries (Part 2.5)
CREATE OR REPLACE FUNCTION forbid_ledger_entries_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_entries_mutation();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_entries_mutation();

-- Zero-sum-per-currency enforcement (Part 3.3), deferred so a whole
-- transaction's entries can be inserted before the check runs.
CREATE OR REPLACE FUNCTION check_ledger_zero_sum()
RETURNS trigger AS $$
DECLARE
  imbalance RECORD;
BEGIN
  SELECT currency, SUM(amount) AS total
  INTO imbalance
  FROM ledger_entries
  WHERE txn_id = NEW.txn_id AND currency = NEW.currency
  GROUP BY currency
  HAVING SUM(amount) <> 0;

  IF FOUND THEN
    RAISE EXCEPTION 'ledger_txns % is not zero-sum for currency % (sum=%)',
      NEW.txn_id, imbalance.currency, imbalance.total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_zero_sum
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_zero_sum();

-- Materialized view of current balances per account/currency (Part 1.4)
CREATE MATERIALIZED VIEW ledger_balances AS
SELECT account_id, currency, SUM(amount) AS balance
FROM ledger_entries
GROUP BY account_id, currency;

CREATE UNIQUE INDEX ledger_balances_account_currency_idx
  ON ledger_balances (account_id, currency);
