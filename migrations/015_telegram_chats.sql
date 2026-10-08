CREATE TABLE telegram_chats (
 chat_id text PRIMARY KEY CHECK(chat_id ~ '^-[1-9][0-9]{0,15}$'),
 type text NOT NULL DEFAULT 'unknown' CHECK(type IN ('unknown','group','supergroup','channel')),
 title text NOT NULL DEFAULT '',
 username text NOT NULL DEFAULT '',
 bot_status text NOT NULL DEFAULT 'unknown',
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO telegram_chats(chat_id,type,title,username,updated_at)
SELECT DISTINCT ON (chat->>'id') chat->>'id',chat->>'type',left(coalesce(chat->>'title',''),250),left(coalesce(chat->>'username',''),100),received_at
FROM telegram_updates CROSS JOIN LATERAL (VALUES(body->'message'->'chat'),(body->'edited_message'->'chat'),(body->'channel_post'->'chat'),(body->'edited_channel_post'->'chat'),(body->'my_chat_member'->'chat')) known(chat)
WHERE chat->>'type' IN ('group','supergroup','channel') AND chat->>'id' ~ '^-[1-9][0-9]{0,15}$'
ORDER BY chat->>'id',received_at DESC
ON CONFLICT DO NOTHING;
