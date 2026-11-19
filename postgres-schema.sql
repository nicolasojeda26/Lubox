create table if not exists public.gym_state (
  id text primary key check (id = 'lubox'),
  data jsonb not null default '{"students":[],"payments":[],"settings":{"whatsappRemindersEnabled":false,"reminderDays":14}}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_reminder_log (
  id bigint generated always as identity primary key,
  student_id text not null,
  due_date date not null,
  status text not null check (status in ('pending', 'sent', 'failed')),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  error text,
  unique (student_id, due_date)
);
