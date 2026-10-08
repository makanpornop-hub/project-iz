ALTER TABLE workflow_archives ADD COLUMN telegram_chat_id text, ADD COLUMN telegram_sent_at timestamptz;
CREATE TABLE workflow_archive_deliveries(archive_id uuid NOT NULL REFERENCES workflow_archives(id),part integer NOT NULL,message_id text NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(archive_id,part));
