-- =========================================================
-- 0002_encriptacion.sql
-- Encripta/desencripta el CUIL de cada legajo con pgcrypto.
-- La clave vive en `app_secrets`, tabla a la que ningún rol de la
-- API puede acceder directamente — solo estas funciones, que son
-- SECURITY DEFINER (corren con el dueño de la función, no con el
-- rol de quien las llama), pueden leerla.
-- =========================================================

create or replace function encrypt_cuit(p_cuit text)
returns bytea
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text;
begin
  select value into v_clave from app_secrets where key = 'encryption_key';
  if v_clave is null then
    raise exception 'No se encontró la clave de encriptación (app_secrets.encryption_key).';
  end if;
  return pgp_sym_encrypt(p_cuit, v_clave);
end;
$$;

create or replace function decrypt_cuit(p_cuit_enc bytea)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text;
begin
  select value into v_clave from app_secrets where key = 'encryption_key';
  if v_clave is null then
    raise exception 'No se encontró la clave de encriptación (app_secrets.encryption_key).';
  end if;
  return pgp_sym_decrypt(p_cuit_enc, v_clave);
end;
$$;

-- Estas SÍ se habilitan para 'authenticated': como esta versión no
-- tiene un servidor intermedio, el propio navegador (ya logueado)
-- las llama para encriptar antes de guardar y desencriptar al leer.
-- La seguridad de fondo la sigue dando RLS (solo ves TUS legajos) +
-- que `app_secrets` nunca es legible desde afuera.
revoke all on function encrypt_cuit(text) from public, anon;
revoke all on function decrypt_cuit(bytea) from public, anon;
grant execute on function encrypt_cuit(text) to authenticated, service_role;
grant execute on function decrypt_cuit(bytea) to authenticated, service_role;

-- ---------------------------------------------------------
-- Vista con el CUIL ya desencriptado, para no tener que pedirlo
-- aparte por cada fila desde el frontend. `security_invoker = true`
-- hace que la vista respete la RLS de `legajos` según quién consulte.
-- ---------------------------------------------------------
create or replace view legajos_vista
with (security_invoker = true)
as
select
  id, cliente_id, legajo, decrypt_cuit(cuil_enc) as cuil,
  nombre, fecha_ingreso, tipo_contrato, categoria, tarea,
  obra_social, cct, banco, basico, estado, fecha_egreso, created_at
from legajos;
