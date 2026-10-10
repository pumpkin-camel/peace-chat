-- Peace Chat: rooms, members, messages, profiles, storage, realtime

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default '平和な部屋',
  invite_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  original_content text,
  filtered boolean not null default false,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.profiles enable row level security;

-- rooms
create policy "rooms_select_member" on public.rooms
  for select to authenticated
  using (exists (select 1 from public.room_members m where m.room_id = id and m.user_id = auth.uid()));

create policy "rooms_insert_creator" on public.rooms
  for insert to authenticated
  with check (auth.uid() = created_by);

-- room_members
create policy "members_select_visible" on public.room_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.room_members m2
      where m2.room_id = room_id and m2.user_id = auth.uid()
    )
  );

create policy "members_insert_self" on public.room_members
  for insert to authenticated
  with check (user_id = auth.uid());

-- messages
create policy "messages_select_member" on public.messages
  for select to authenticated
  using (exists (select 1 from public.room_members m where m.room_id = room_id and m.user_id = auth.uid()));

create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.room_members m where m.room_id = room_id and m.user_id = auth.uid())
  );

-- profiles
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 招待コードで部屋に参加（RLS をバイパスする Security Definer）
create or replace function public.join_room_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  select id into v_room_id from public.rooms where invite_code = p_code;
  if v_room_id is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  insert into public.room_members (room_id, user_id)
  values (v_room_id, auth.uid())
  on conflict do nothing;
  return v_room_id;
end;
$$;

grant execute on function public.join_room_with_code(text) to authenticated;

-- Realtime
alter publication supabase_realtime add table public.messages;

-- Storage: chat-images バケット（公開読み取り）
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

create policy "chat_images_public_read" on storage.objects
  for select to public using (bucket_id = 'chat-images');

create policy "chat_images_auth_insert_own_folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
