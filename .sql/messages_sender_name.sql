-- 送信者表示名をメッセージにスナップショット保存（profiles 結合を避けるため）
alter table public.messages add column if not exists sender_name text not null default '';
