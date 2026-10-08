CREATE TABLE case_finances (
 case_id uuid PRIMARY KEY REFERENCES cases(id), contract_amount numeric(16,2) CHECK(contract_amount>=0), payment_deadline date,
 financial_status text NOT NULL DEFAULT 'UNSET', warnings text[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 updated_by text REFERENCES staff(user_id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE expense_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, category text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_types_name ON expense_types(lower(name));
CREATE TABLE client_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES cases(id), request_key uuid NOT NULL UNIQUE,
 amount numeric(16,2) NOT NULL CHECK(amount>0), paid_on date NOT NULL,
 type text NOT NULL CHECK(type IN ('INITIAL','ADDITIONAL','FULL','REFUND','OTHER')),
 method text NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER','OTHER')), comment text NOT NULL DEFAULT '',
 created_by text NOT NULL REFERENCES staff(user_id), updated_by text NOT NULL REFERENCES staff(user_id),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX client_payments_case ON client_payments(case_id,paid_on);
ALTER TABLE documents ADD COLUMN finance_receipt boolean NOT NULL DEFAULT false;
CREATE TABLE client_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES cases(id), request_key uuid NOT NULL UNIQUE,
 amount numeric(16,2) NOT NULL CHECK(amount>0), spent_on date NOT NULL, expense_type_id uuid NOT NULL REFERENCES expense_types(id),
 type_name text NOT NULL, type_category text NOT NULL DEFAULT '', method text NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER','OTHER')),
 comment text NOT NULL DEFAULT '', receipt_version_id uuid REFERENCES document_versions(id),
 created_by text NOT NULL REFERENCES staff(user_id), updated_by text NOT NULL REFERENCES staff(user_id),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX client_expenses_case ON client_expenses(case_id,spent_on);
CREATE TABLE financial_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES cases(id), kind text NOT NULL CHECK(kind IN ('PAYMENT_OVERDUE','EXPENSES_EXCEED_PAYMENTS')),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, sent_at timestamptz, telegram_message_id text
);
CREATE UNIQUE INDEX financial_events_active ON financial_events(case_id,kind) WHERE resolved_at IS NULL;
INSERT INTO expense_types(name,category,sort_order) VALUES ('Перевод документов','Переводы',10),('Перевод нотариальный','Переводы',20),('Перевод паспорта','Переводы',30),('Апостиль','Документы',40),('Государственная пошлина','Пошлины',50);
INSERT INTO permissions(id) VALUES ('accounting.view'),('accounting.manage'),('accounting.view_contract'),('accounting.view_profit'),('expenses.create'),('expenses.edit'),('payments.create'),('payments.edit'),('expense_types.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.id='Administrator' AND p.id IN ('accounting.view','accounting.manage','accounting.view_contract','accounting.view_profit','expenses.create','expenses.edit','payments.create','payments.edit','expense_types.manage') ON CONFLICT DO NOTHING;
