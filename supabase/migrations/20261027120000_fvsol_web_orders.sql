-- FVSOL – zakázky z webu fvsol.cz
-- Běží ve stejném Supabase projektu jako CRM „zakazky-crm“ (free tarif dovoluje 2 projekty).
-- Existující tabulky CRM (workspaces, workspace_members, jobs) se nemění.
--
-- Přístupový model:
--   * zákazník nemá účet – k zakázce se dostane jen přes tajný odkaz (token), vše jde přes Edge funkci „intake“
--     se service role; anon role nemá k tabulkám žádný přístup,
--   * administrace = přihlášený uživatel, jehož e-mail je v tabulce staff (spravuje se jen přes SQL).
--     Záměrně se neodvozuje od členství v CRM, protože do CRM si může účet založit kdokoli.

-- ---------------------------------------------------------------- personál
create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  name       text,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;
drop policy if exists staff_self on public.staff;
create policy staff_self on public.staff for select to authenticated using (email = public.my_email());
insert into public.staff(email, name) values ('fholesz@gmail.com', 'Filip Holesz') on conflict do nothing;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_email() <> '' and exists (select 1 from public.staff where email = public.my_email())
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- zákazníci
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(email) and email like '%@%'),
  name       text,
  phone      text,
  company    text,
  ico        text,
  kind       text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- firemní profily a vzory
create table if not exists public.company_profiles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 160),
  ico        text,
  address    text,
  contact    text,
  notes      text,
  logo_path  text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.doc_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.company_profiles(id) on delete restrict, -- null = univerzální vzor
  kind        text not null check (kind in ('titulni_list','pruvodni_zprava','technicka_zprava','razitko','vykresovy_ramecek','cad_vzor','vykaz_materialu','jednopolove_schema','jine')),
  service     text not null default 'any' check (service in ('fve','lps','dwg','any')),
  name        text not null check (length(name) between 1 and 160),
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists doc_templates_company_idx on public.doc_templates(company_id);

create table if not exists public.doc_template_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.doc_templates(id) on delete restrict,
  version      int  not null,
  storage_path text not null unique,
  file_name    text not null,
  mime         text,
  size         bigint,
  placeholders jsonb not null default '[]'::jsonb,
  note         text,
  is_current   boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   text,
  unique (template_id, version)
);
create unique index if not exists doc_template_versions_one_current on public.doc_template_versions(template_id) where is_current;

create or replace function public.template_version_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(version), 0) + 1 into new.version from public.doc_template_versions where template_id = new.template_id;
    new.created_by = coalesce(nullif(public.my_email(), ''), new.created_by, 'system');
    if new.is_current then
      update public.doc_template_versions set is_current = false where template_id = new.template_id and is_current;
    end if;
  else
    if new.template_id <> old.template_id or new.version <> old.version or new.storage_path <> old.storage_path then
      raise exception 'Verze vzoru se nedá přepsat – nahrajte novou verzi.';
    end if;
    if new.is_current and not old.is_current then
      update public.doc_template_versions set is_current = false where template_id = new.template_id and is_current and id <> new.id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists template_version_before on public.doc_template_versions;
create trigger template_version_before before insert or update on public.doc_template_versions
  for each row execute function public.template_version_before();

-- ---------------------------------------------------------------- zakázky
create sequence if not exists public.order_code_seq;

create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,
  service            text not null check (service in ('fve','lps','dwg','individual')),
  phase              text not null default 'draft' check (phase in ('draft','inquiry','order','cancelled')),
  status             text not null default 'rozpracovana' check (status in (
                       'rozpracovana','ceka_na_podklady','podklady_k_overeni','pripravena',
                       'zpracovava_se','ceka_na_kontrolu','dokoncena','rucni_posouzeni')),
  customer_id        uuid references public.customers(id) on delete set null,
  contact            jsonb not null default '{}'::jsonb,
  answers            jsonb not null default '{}'::jsonb,
  site               jsonb not null default '{}'::jsonb,
  completeness       jsonb not null default '{}'::jsonb,
  needs_review       boolean not null default false,
  company_profile_id uuid references public.company_profiles(id) on delete restrict,
  template_selection jsonb not null default '{}'::jsonb,
  workflow           jsonb not null default '{}'::jsonb,  -- interní postup: kontrola, nabídka, potvrzení, zpracování, kontrola, klient, schválení, faktura
  created_ip_hash    text,
  price_note         text,
  due_date           date,
  crm_job_id         text,
  submitted_at       timestamptz,
  confirmed_at       timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders(phase, status);
create index if not exists orders_service_idx on public.orders(service);
create index if not exists orders_created_idx on public.orders(created_at desc);

-- přístupové odkazy zákazníka: v databázi je jen otisk (SHA-256), každý e-mail může nést nový odkaz, staré platí dál
create table if not exists public.order_tokens (
  token_hash text primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  purpose    text not null default 'web' check (purpose in ('web','email','manual')),
  revoked    boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists order_tokens_order_idx on public.order_tokens(order_id);

create table if not exists public.order_files (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  direction           text not null default 'in' check (direction in ('in','out')),
  category            text not null default 'jine',
  storage_path        text not null unique,
  file_name           text not null,
  mime                text,
  size                bigint,
  status              text not null default 'pending' check (status in ('pending','uploaded','rejected')),
  meta                jsonb not null default '{}'::jsonb,
  uploaded_by         text,
  -- jen pro výstupy (direction = 'out')
  output_kind         text,
  output_version      int,
  source              text,               -- 'auto:situace_dxf', 'auto:docx', 'rucne'
  template_version_id uuid references public.doc_template_versions(id) on delete restrict,
  review_status       text not null default 'neovereno' check (review_status in ('neovereno','overeno','zamitnuto')),
  reviewed_by         text,
  reviewed_at         timestamptz,
  released            boolean not null default false,
  released_at         timestamptz,
  note                text,
  created_at          timestamptz not null default now(),
  uploaded_at         timestamptz
);
create index if not exists order_files_order_idx on public.order_files(order_id, direction);

create table if not exists public.order_events (
  id                  bigint generated always as identity primary key,
  order_id            uuid not null references public.orders(id) on delete cascade,
  at                  timestamptz not null default now(),
  actor               text not null default 'system',
  type                text not null check (type in ('created','submitted','status','phase','note','info_request','info_response',
                        'file','output','email','automation','geo','template','crm','workflow','error')),
  visible_to_customer boolean not null default false,
  message             text,
  data                jsonb not null default '{}'::jsonb
);
create index if not exists order_events_order_idx on public.order_events(order_id, at);

create table if not exists public.info_requests (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  message     text not null,
  items       jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open','answered','closed')),
  answer      jsonb,
  created_at  timestamptz not null default now(),
  created_by  text,
  answered_at timestamptz
);
create index if not exists info_requests_order_idx on public.info_requests(order_id, status);

create table if not exists public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  task           text not null,
  runner         text not null default 'edge' check (runner in ('edge','external')),
  status         text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  input          jsonb not null default '{}'::jsonb,
  result         jsonb,
  error          text,
  output_file_id uuid references public.order_files(id) on delete set null,
  created_by     text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index if not exists automation_runs_order_idx on public.automation_runs(order_id, created_at desc);

-- interní tabulky jen pro Edge funkce (service role)
create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
create table if not exists public.geo_cache (
  key        text primary key,
  data       jsonb not null,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------- pojistky a historie
create or replace function public.orders_before() returns trigger
language plpgsql set search_path = public as $$
declare v record;
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    if new.status = 'dokoncena' and old.status is distinct from 'dokoncena' then
      if not exists (select 1 from public.order_files f
                     where f.order_id = new.id and f.direction = 'out' and f.released and f.review_status = 'overeno') then
        raise exception 'Zakázku nelze označit jako dokončenou: chybí ověřený a předaný výstup.';
      end if;
      new.completed_at = now();
    end if;
    if new.phase = 'order' and old.phase is distinct from 'order' then new.confirmed_at = coalesce(new.confirmed_at, now()); end if;
    if new.phase = 'cancelled' and old.phase is distinct from 'cancelled' then new.cancelled_at = now(); end if;
    if new.phase = 'draft' and old.phase <> 'draft' then
      raise exception 'Odeslanou poptávku nelze vrátit do rozpracovaného zadání.';
    end if;
  end if;
  -- vzory: vybrat lze jen univerzální vzor nebo vzor firmy přiřazené k zakázce
  for v in select value from jsonb_each_text(coalesce(new.template_selection, '{}'::jsonb)) loop
    if not exists (
      select 1 from public.doc_template_versions tv join public.doc_templates t on t.id = tv.template_id
      where tv.id::text = v.value and (t.company_id is null or t.company_id = new.company_profile_id)
    ) then
      raise exception 'Vybraný vzor nepatří k firmě přiřazené k zakázce ani není univerzální.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists orders_before on public.orders;
create trigger orders_before before insert or update on public.orders for each row execute function public.orders_before();

create or replace function public.orders_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(nullif(public.my_email(), ''), 'system');
begin
  if new.status is distinct from old.status then
    insert into public.order_events(order_id, actor, type, visible_to_customer, data)
    values (new.id, who, 'status', new.phase <> 'draft', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.phase is distinct from old.phase then
    insert into public.order_events(order_id, actor, type, visible_to_customer, data)
    values (new.id, who, 'phase', true, jsonb_build_object('from', old.phase, 'to', new.phase));
  end if;
  return new;
end $$;
drop trigger if exists orders_after on public.orders;
create trigger orders_after after update on public.orders for each row execute function public.orders_after();

create or replace function public.order_files_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.direction = 'in' and (new.released or new.review_status <> 'neovereno') then
    raise exception 'Ověření a předání se týká jen výstupů.';
  end if;
  if new.review_status = 'overeno' and (tg_op = 'INSERT' or old.review_status is distinct from 'overeno') then
    if public.my_email() = '' then
      raise exception 'Výstup může jako ověřený označit jen přihlášený projektant.';
    end if;
    new.reviewed_by = public.my_email();
    new.reviewed_at = now();
  end if;
  if new.review_status <> 'overeno' and tg_op = 'UPDATE' and old.review_status = 'overeno' then
    new.released = false;
  end if;
  if new.released and new.review_status <> 'overeno' then
    raise exception 'Výstup lze předat zákazníkovi až po ověření projektantem.';
  end if;
  if new.released and (tg_op = 'INSERT' or not old.released) then new.released_at = now(); end if;
  if not new.released then new.released_at = null; end if;
  return new;
end $$;
drop trigger if exists order_files_before on public.order_files;
create trigger order_files_before before insert or update on public.order_files for each row execute function public.order_files_before();

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
drop trigger if exists company_profiles_touch on public.company_profiles;
create trigger company_profiles_touch before update on public.company_profiles for each row execute function public.touch_updated_at();
drop trigger if exists doc_templates_touch on public.doc_templates;
create trigger doc_templates_touch before update on public.doc_templates for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- pomocné funkce pro Edge funkce
create or replace function public.next_order_code() returns text
language sql volatile security definer set search_path = public as $$
  select 'Z' || to_char(now() at time zone 'Europe/Prague', 'YY') || '-' || lpad(nextval('public.order_code_seq')::text, 4, '0')
$$;

create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
        n int;
begin
  insert into public.rate_limits(key, window_start, hits) values (p_key, ws, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  if random() < 0.02 then delete from public.rate_limits where window_start < now() - interval '2 days'; end if;
  return n <= p_max;
end $$;

revoke all on function public.next_order_code() from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.next_order_code() to service_role;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;
revoke all on function public.orders_after() from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS: jen personál
do $$
declare t text;
begin
  foreach t in array array['customers','company_profiles','doc_templates','doc_template_versions','orders','order_tokens',
                           'order_files','order_events','info_requests','automation_runs','rate_limits','geo_cache']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['customers','company_profiles','doc_templates','doc_template_versions','orders',
                           'order_files','order_events','info_requests','automation_runs']
  loop
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('drop policy if exists staff_update on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
revoke all on public.rate_limits, public.geo_cache, public.order_tokens from authenticated;

-- mazání: zakázky jen rozpracované nebo zrušené, soubory a poznámky bez omezení; profily a vzory se nemažou (jen deaktivují)
drop policy if exists staff_delete on public.orders;
create policy staff_delete on public.orders for delete to authenticated using (public.is_staff() and phase in ('draft','cancelled'));
drop policy if exists staff_delete on public.order_files;
create policy staff_delete on public.order_files for delete to authenticated using (public.is_staff() and not released);
drop policy if exists staff_delete on public.info_requests;
create policy staff_delete on public.info_requests for delete to authenticated using (public.is_staff());
-- historie je jen pro zápis
revoke update, delete on public.order_events from authenticated;
drop policy if exists staff_update on public.order_events;

-- ---------------------------------------------------------------- úložiště
insert into storage.buckets (id, name, public, file_size_limit)
values ('fvsol-orders', 'fvsol-orders', false, 52428800),
       ('fvsol-templates', 'fvsol-templates', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists fvsol_staff_select on storage.objects;
drop policy if exists fvsol_staff_insert on storage.objects;
drop policy if exists fvsol_staff_update on storage.objects;
drop policy if exists fvsol_staff_delete on storage.objects;
create policy fvsol_staff_select on storage.objects for select to authenticated
  using (bucket_id in ('fvsol-orders','fvsol-templates') and public.is_staff());
create policy fvsol_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('fvsol-orders','fvsol-templates') and public.is_staff());
create policy fvsol_staff_update on storage.objects for update to authenticated
  using (bucket_id in ('fvsol-orders','fvsol-templates') and public.is_staff());
create policy fvsol_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fvsol-orders' and public.is_staff());
