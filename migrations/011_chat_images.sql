CREATE TABLE chat_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid REFERENCES cases(id),
 room_id uuid REFERENCES chat_rooms(id),
 uploaded_by text NOT NULL REFERENCES staff(user_id),
 request_id uuid NOT NULL,
 storage_key text NOT NULL UNIQUE,
 filename text NOT NULL,
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 size integer NOT NULL CHECK(size>0 AND size<=20971520),
 checksum text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((case_id IS NULL) <> (room_id IS NULL)),
 UNIQUE(uploaded_by,request_id)
);
ALTER TABLE case_chat_messages ADD COLUMN image_id uuid UNIQUE REFERENCES chat_images(id);
ALTER TABLE chat_room_messages ADD COLUMN image_id uuid UNIQUE REFERENCES chat_images(id);
ALTER TABLE chat_room_messages DROP CONSTRAINT chat_room_messages_body_check;
ALTER TABLE chat_room_messages ADD CONSTRAINT chat_room_messages_body_check CHECK(length(body)<=10000 AND (length(trim(body))>0 OR image_id IS NOT NULL));
