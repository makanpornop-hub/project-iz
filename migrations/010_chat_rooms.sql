CREATE TABLE chat_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('direct','group')),
 title text NOT NULL DEFAULT '',
 owner_id text NOT NULL REFERENCES staff(user_id),
 direct_key text UNIQUE,
 request_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='direct' AND direct_key IS NOT NULL) OR (kind='group' AND direct_key IS NULL))
);
CREATE TABLE chat_room_members (
 room_id uuid NOT NULL REFERENCES chat_rooms(id),
 user_id text NOT NULL REFERENCES staff(user_id),
 active boolean NOT NULL DEFAULT true,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id)
);
CREATE INDEX ON chat_room_members(user_id,active);
CREATE TABLE chat_room_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id uuid NOT NULL REFERENCES chat_rooms(id),
 author_id text NOT NULL REFERENCES staff(user_id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 reply_to bigint REFERENCES chat_room_messages(id),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(author_id,request_id)
);
CREATE INDEX ON chat_room_messages(room_id,id DESC);
CREATE TABLE chat_room_reads (
 message_id bigint NOT NULL REFERENCES chat_room_messages(id),
 user_id text NOT NULL REFERENCES staff(user_id),
 PRIMARY KEY(message_id,user_id)
);
ALTER TABLE notifications ADD COLUMN room_message_id bigint REFERENCES chat_room_messages(id);