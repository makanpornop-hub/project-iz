CREATE TABLE partner_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 250),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES partner_groups(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 250),
 phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 country text NOT NULL DEFAULT '',
 city text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partners_group_id ON partners(group_id);
INSERT INTO permissions(id) VALUES('can_manage_partners') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT id,'can_manage_partners' FROM roles WHERE id IN ('Administrator','Manager')
 ON CONFLICT DO NOTHING;

