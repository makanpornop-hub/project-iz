CREATE TABLE workflow_archives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES cases(id),
 filename text NOT NULL,
 storage_key text NOT NULL UNIQUE,
 size bigint NOT NULL,
 file_count integer NOT NULL,
 version_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_archives_case ON workflow_archives(case_id,created_at DESC);
