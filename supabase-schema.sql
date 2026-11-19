create table if not exists public.gym_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"students":[],"payments":[],"settings":{"whatsappRemindersEnabled":false,"reminderDays":14}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gym_state enable row level security;
revoke all on public.gym_state from anon, authenticated;
grant select, insert, update on public.gym_state to authenticated;
grant select, update on public.gym_state to service_role;

drop policy if exists "Owner can read own gym state" on public.gym_state;
create policy "Owner can read own gym state" on public.gym_state
  for select to authenticated using (auth.uid() = owner_id);

drop policy if exists "Owner can insert own gym state" on public.gym_state;
create policy "Owner can insert own gym state" on public.gym_state
  for insert to authenticated with check (auth.uid() = owner_id);

drop policy if exists "Owner can update own gym state" on public.gym_state;
create policy "Owner can update own gym state" on public.gym_state
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create table if not exists public.whatsapp_reminder_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id text not null,
  due_date date not null,
  status text not null check (status in ('pending', 'sent', 'failed')),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  error text,
  unique (owner_id, student_id, due_date)
);

alter table public.whatsapp_reminder_log enable row level security;
revoke all on public.whatsapp_reminder_log from anon, authenticated;
grant all on public.whatsapp_reminder_log to service_role;
grant usage, select on sequence public.whatsapp_reminder_log_id_seq to service_role;
