CREATE TABLE case_chat_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES cases(id),
 document_id uuid NOT NULL REFERENCES documents(id),
 version_id uuid NOT NULL REFERENCES document_versions(id),
 latest_version_id uuid REFERENCES document_versions(id),
 author_id text NOT NULL REFERENCES staff(user_id),
 assignee_id text NOT NULL REFERENCES staff(user_id),
 deadline timestamptz,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','closed')),
 closed_by text REFERENCES staff(user_id), closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON case_chat_threads(case_id,document_id,status);
CREATE TABLE case_chat_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL REFERENCES cases(id),
 thread_id uuid REFERENCES case_chat_threads(id),
 author_id text NOT NULL REFERENCES staff(user_id),
 body text NOT NULL CHECK(length(body)<=10000),
 version_id uuid REFERENCES document_versions(id),
 reply_to bigint REFERENCES case_chat_messages(id),
 mention_ids text[] NOT NULL DEFAULT '{}',
 kind text NOT NULL DEFAULT 'message' CHECK(kind IN ('message','issue','upload','closed','reopened')),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(author_id,request_id)
);
CREATE INDEX ON case_chat_messages(case_id,id DESC);
CREATE INDEX ON case_chat_messages(thread_id,id);
CREATE TABLE case_chat_reads (
 message_id bigint NOT NULL REFERENCES case_chat_messages(id),
 user_id text NOT NULL REFERENCES staff(user_id),
 PRIMARY KEY(message_id,user_id)
);
ALTER TABLE notifications ADD COLUMN chat_message_id bigint REFERENCES case_chat_messages(id);