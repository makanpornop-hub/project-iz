INSERT INTO case_statuses(id) VALUES ('Additional request') ON CONFLICT DO NOTHING;

CREATE TABLE case_followups (
  case_id uuid PRIMARY KEY REFERENCES cases(id),
  archive_id uuid NOT NULL REFERENCES workflow_archives(id),
  check_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  notified_at timestamptz,
  telegram_sent_at timestamptz,
  created_by text NOT NULL REFERENCES staff(user_id),
  updated_by text NOT NULL REFERENCES staff(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_followups_due ON case_followups(check_at) WHERE notified_at IS NULL;
