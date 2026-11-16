-- Nová služba „Smart home (Loxone)“ ve formuláři zakázek.
alter table public.orders drop constraint if exists orders_service_check;
alter table public.orders add constraint orders_service_check
  check (service in ('fve','lps','smarthome','dwg','individual'));
