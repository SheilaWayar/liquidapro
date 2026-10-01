-- =========================================================
-- 0001_init.sql
-- Esquema simplificado, alineado 1 a 1 con los campos que ya
-- usa el frontend (clientes / legajos / liquidaciones), para que
-- la app funcione apenas se pegan las credenciales de Supabase.
-- =========================================================

create extension if not exists "pgcrypto";

-- =========================================================
-- CLIENTES (empleadores)
-- =========================================================
create table if not exists clientes (
  id            uuid primary key default gen_random_uuid(),
  cuit          text not null,
  razon_social  text not null,
  domicilio     text,
  provincia     text,
  banco_default text,
  estado        text not null default 'activo' check (estado in ('activo', 'baja')),
  created_at    timestamptz not null default now()
);

-- =========================================================
-- USUARIOS <-> CLIENTES (qué contador puede ver qué cliente)
-- =========================================================
create table if not exists usuarios_clientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cliente_id  uuid not null references clientes(id) on delete cascade,
  rol         text not null default 'admin' check (rol in ('admin', 'contador', 'lectura')),
  created_at  timestamptz not null default now(),
  unique (user_id, cliente_id)
);

-- =========================================================
-- LEGAJOS (empleados). El CUIL se guarda encriptado (ver 0002).
-- No se borra nunca: baja lógica con `estado`.
-- =========================================================
create table if not exists legajos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes(id),
  legajo          text not null,
  cuil_enc        bytea not null,
  nombre          text not null,
  fecha_ingreso   date,
  tipo_contrato   text,
  categoria       text,
  tarea           text,
  obra_social     text,
  cct             text,
  banco           text,
  basico          numeric(14,2),
  estado          text not null default 'activo' check (estado in ('activo', 'baja')),
  fecha_egreso    date,
  created_at      timestamptz not null default now(),
  unique (cliente_id, legajo)
);

-- =========================================================
-- LIQUIDACIONES: se guarda el resultado completo (ya calculado)
-- como JSONB, tal cual lo arma calculos.js — más simple y evita
-- tener que normalizar cada concepto en columnas separadas.
-- No se borra nunca: se anula con `estado`.
-- =========================================================
create table if not exists liquidaciones (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id),
  legajo_id         uuid not null references legajos(id),
  periodo           text not null,        -- 'YYYY-MM'
  periodo_texto     text not null,        -- 'MARZO 2026'
  tipo_liquidacion  text not null default 'general',
  quincena_texto    text,
  fecha_pago        date,
  resultado         jsonb not null,       -- objeto devuelto por Calculos.calcular()
  estado            text not null default 'cerrada' check (estado in ('cerrada', 'anulada')),
  creada_por        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_legajos_cliente on legajos (cliente_id);
create index if not exists idx_liquidaciones_cliente on liquidaciones (cliente_id);
create index if not exists idx_liquidaciones_legajo on liquidaciones (legajo_id);

-- =========================================================
-- AUDITORÍA (Ley 25.326)
-- =========================================================
create table if not exists auditoria (
  id                uuid primary key default gen_random_uuid(),
  tabla             text not null,
  registro_id       uuid not null,
  accion            text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario           uuid,
  fecha             timestamptz not null default now(),
  datos_anteriores  jsonb
);

create index if not exists idx_auditoria_tabla_registro on auditoria (tabla, registro_id);

-- =========================================================
-- SECRETO de encriptación (clave para pgcrypto).
-- Se autogenera una vez, acá mismo, para que el sistema quede
-- funcionando sin pasos manuales extra. Tabla completamente
-- bloqueada para los roles de la API (ver GRANT/REVOKE abajo).
-- =========================================================
create table if not exists app_secrets (
  key    text primary key,
  value  text not null
);

insert into app_secrets (key, value)
values ('encryption_key', encode(gen_random_bytes(32), 'base64'))
on conflict (key) do nothing;

revoke all on app_secrets from public, anon, authenticated;
