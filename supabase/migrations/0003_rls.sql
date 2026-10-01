-- =========================================================
-- 0003_rls.sql
-- Row Level Security: cada usuario logueado solo ve los clientes
-- (empleadores) que administra, y por lo tanto solo sus legajos
-- y liquidaciones.
-- =========================================================

create or replace function mis_clientes()
returns setof uuid
language sql
security definer
stable
as $$
  select cliente_id from usuarios_clientes where user_id = auth.uid();
$$;

-- ---------------------------------------------------------
-- CLIENTES
-- ---------------------------------------------------------
alter table clientes enable row level security;

create policy "clientes_select_propios" on clientes for select
  using (id in (select mis_clientes()));

-- Cualquier usuario logueado puede dar de alta un cliente nuevo
-- (el trigger de abajo lo vincula automáticamente a su usuario).
create policy "clientes_insert_autenticado" on clientes for insert
  with check (auth.role() = 'authenticated');

create policy "clientes_update_propios" on clientes for update
  using (id in (select mis_clientes()))
  with check (id in (select mis_clientes()));

-- Sin policy de DELETE: la baja es lógica (UPDATE estado = 'baja').

-- Auto-vincula al creador de un cliente nuevo como su 'admin'
create or replace function fn_auto_vincular_cliente()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into usuarios_clientes (user_id, cliente_id, rol)
  values (auth.uid(), new.id, 'admin');
  return new;
end;
$$;

drop trigger if exists trg_auto_vincular_cliente on clientes;
create trigger trg_auto_vincular_cliente
  after insert on clientes
  for each row execute function fn_auto_vincular_cliente();

-- ---------------------------------------------------------
-- USUARIOS_CLIENTES
-- ---------------------------------------------------------
alter table usuarios_clientes enable row level security;

create policy "usuarios_clientes_select_propias" on usuarios_clientes for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------
-- LEGAJOS
-- ---------------------------------------------------------
alter table legajos enable row level security;

create policy "legajos_select_por_cliente" on legajos for select
  using (cliente_id in (select mis_clientes()));

create policy "legajos_insert_por_cliente" on legajos for insert
  with check (cliente_id in (select mis_clientes()));

create policy "legajos_update_por_cliente" on legajos for update
  using (cliente_id in (select mis_clientes()))
  with check (cliente_id in (select mis_clientes()));

-- Sin policy de DELETE (bloqueado también por trigger, ver 0004).

-- ---------------------------------------------------------
-- LIQUIDACIONES
-- ---------------------------------------------------------
alter table liquidaciones enable row level security;

create policy "liquidaciones_select_por_cliente" on liquidaciones for select
  using (cliente_id in (select mis_clientes()));

create policy "liquidaciones_insert_por_cliente" on liquidaciones for insert
  with check (cliente_id in (select mis_clientes()));

-- Solo se puede actualizar el estado (para anular), nunca el resultado.
create policy "liquidaciones_update_por_cliente" on liquidaciones for update
  using (cliente_id in (select mis_clientes()))
  with check (cliente_id in (select mis_clientes()));

-- Sin policy de DELETE: ver trigger de bloqueo en 0004.

-- ---------------------------------------------------------
-- AUDITORIA: sin policies -> invisible/inaccesible para anon y authenticated.
-- ---------------------------------------------------------
alter table auditoria enable row level security;
