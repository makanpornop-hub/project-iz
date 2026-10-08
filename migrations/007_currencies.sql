CREATE TABLE exchange_rates (
 currency text NOT NULL CHECK(currency IN ('USD','EUR')), rate_date date NOT NULL,
 rate numeric(20,8) NOT NULL CHECK(rate>0), fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(currency,rate_date)
);
CREATE TABLE exchange_sync (id integer PRIMARY KEY CHECK(id=1), attempted_at timestamptz, succeeded_at timestamptz, error text);
INSERT INTO exchange_sync(id) VALUES(1);
ALTER TABLE case_finances ADD COLUMN currency text NOT NULL DEFAULT 'UZS' CHECK(currency IN ('UZS','USD','EUR')),
 ADD COLUMN original_amount numeric(16,2), ADD COLUMN exchange_rate numeric(20,8) NOT NULL DEFAULT 1,
 ADD COLUMN rate_date date;
UPDATE case_finances SET original_amount=contract_amount;
ALTER TABLE client_payments ADD COLUMN currency text NOT NULL DEFAULT 'UZS' CHECK(currency IN ('UZS','USD','EUR')),
 ADD COLUMN original_amount numeric(16,2), ADD COLUMN exchange_rate numeric(20,8) NOT NULL DEFAULT 1, ADD COLUMN rate_date date;
UPDATE client_payments SET original_amount=amount;
ALTER TABLE client_payments ALTER COLUMN original_amount SET NOT NULL;
ALTER TABLE client_expenses ADD COLUMN currency text NOT NULL DEFAULT 'UZS' CHECK(currency IN ('UZS','USD','EUR')),
 ADD COLUMN original_amount numeric(16,2), ADD COLUMN exchange_rate numeric(20,8) NOT NULL DEFAULT 1, ADD COLUMN rate_date date;
UPDATE client_expenses SET original_amount=amount;
ALTER TABLE client_expenses ALTER COLUMN original_amount SET NOT NULL;
