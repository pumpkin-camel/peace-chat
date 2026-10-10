-- RLSポリシー修正:
-- 1) room_members を自分自身から参照していたポリシーによる無限再帰を解消（security definer 関数経由に変更）
-- 2) サブクエリ内の非修飾カラム参照（m.room_id = room_id がタウトロジーになる）バグを解消
-- 3) 作成者自身も部屋を取得できる rooms_select_creator を追加（作成直後の RETURNING 取得に必要）

drop policy if exists rooms_select_member on public.rooms;
drop policy if exists rooms_insert_creator on public.rooms;
drop policy if exists members_select_visible on public.room_members;
drop policy if exists members_insert_self on public.room_members;
drop policy if exists messages_select_member on public.messages;
drop policy if exists messages_insert_member on public.messages;

create or replace function public.is_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id
  );
$$;

grant execute on function public.is_room_member(uuid, uuid) to authenticated;

create policy "rooms_select_creator_or_member" on public.rooms
  for select to authenticated
  using (created_by = auth.uid() or public.is_room_member(id, auth.uid()));

create policy "rooms_insert_creator" on public.rooms
  for insert to authenticated
  with check (created_by = auth.uid());

create policy "members_select_visible" on public.room_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_room_member(room_id, auth.uid()));

create policy "members_insert_self" on public.room_members
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "messages_select_member" on public.messages
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );
