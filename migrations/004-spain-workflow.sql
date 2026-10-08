ALTER TABLE tasks ALTER COLUMN deadline DROP NOT NULL;
CREATE TABLE case_workflows (
 case_id uuid PRIMARY KEY REFERENCES cases(id),
 task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','approved','rejected')),
 revision integer NOT NULL DEFAULT 1,
 submitted_by text REFERENCES staff(user_id),
 submitted_at timestamptz,
 reviewed_by text REFERENCES staff(user_id),
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT ''
);
CREATE TABLE document_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES case_workflows(case_id),
 name text NOT NULL,
 kind text NOT NULL DEFAULT 'custom',
 sort_order integer NOT NULL,
 notes text NOT NULL DEFAULT '',
 stamp boolean,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_groups_case ON document_groups(case_id);
ALTER TABLE documents ADD COLUMN group_id uuid REFERENCES document_groups(id);
ALTER TABLE documents ADD COLUMN merge_order integer;
ALTER TABLE documents ADD COLUMN is_output boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN required boolean NOT NULL DEFAULT true;
CREATE INDEX documents_group ON documents(group_id);
ALTER TABLE document_versions ADD COLUMN source_version_ids uuid[];


ALTER TABLE documents ADD COLUMN field_order integer NOT NULL DEFAULT 0;
