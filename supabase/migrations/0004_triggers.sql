-- =========================================================
-- 0004_triggers.sql
-- Auditoría automática + bloqueo de borrado físico.
-- =========================================================

create or replace function fn_bloquear_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'No se permite eliminar físicamente registros de %. Usá baja lógica (columna estado).', TG_TABLE_NAME;
end;
$$;

drop trigger if exists trg_bloquear_delete_legajos on legajos;
create trigger trg_bloquear_delete_legajos
  before delete on legajos
  for each row execute function fn_bloquear_delete();

drop trigger if exists trg_bloquear_delete_liquidaciones on liquidaciones;
create trigger trg_bloquear_delete_liquidaciones
  before delete on liquidaciones
  for each row execute function fn_bloquear_delete();

drop trigger if exists trg_bloquear_delete_clientes on clientes;
create trigger trg_bloquear_delete_clientes
  before delete on clientes
  for each row execute function fn_bloquear_delete();

-- ---------------------------------------------------------
-- Auditoría (Ley 25.326): registra todo UPDATE/DELETE
-- ---------------------------------------------------------
create or replace function fn_auditoria()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into auditoria (tabla, registro_id, accion, usuario, datos_anteriores)
  values (TG_TABLE_NAME, OLD.id, TG_OP, auth.uid(), to_jsonb(OLD));
  return OLD;
end;
$$;

drop trigger if exists trg_auditoria_legajos on legajos;
create trigger trg_auditoria_legajos
  after update on legajos
  for each row execute function fn_auditoria();

drop trigger if exists trg_auditoria_liquidaciones on liquidaciones;
create trigger trg_auditoria_liquidaciones
  after update on liquidaciones
  for each row execute function fn_auditoria();

drop trigger if exists trg_auditoria_clientes on clientes;
create trigger trg_auditoria_clientes
  after update on clientes
  for each row execute function fn_auditoria();
