CREATE TABLE contract_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 filename text NOT NULL,
 storage_key text NOT NULL UNIQUE,
 size bigint NOT NULL,
 created_by text NOT NULL REFERENCES staff(user_id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE generated_contracts (
 case_id uuid PRIMARY KEY REFERENCES cases(id),
 template_id uuid NOT NULL REFERENCES contract_templates(id),
 storage_key text NOT NULL UNIQUE,
 filename text NOT NULL,
 size bigint NOT NULL,
 generated_on date NOT NULL,
 values jsonb NOT NULL
);
