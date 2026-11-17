-- =====================================================================
--  Facturación y despacho (seguimiento de pedidos facturados de Cindy Mayorista).
--  Vive en la MISMA base que el generador de rótulos (proyecto snnuxfdwjjqxdnhwouta):
--  usa sus perfiles, clientes y transportes. Todo lo propio lleva el prefijo fac_
--  y no modifica ninguna tabla, función ni política de rótulos.
--
--  Requiere las migraciones de rótulos hasta 20261116010000_clerk_nombre.sql
--  (mi_perfil_id(), perfiles.clerk_id, clientes, transportes).
--  Se puede correr dos veces.
--
--  Roles de facturación (tabla fac_usuarios; el superadmin de rótulos es admin acá):
--    facturacion    -> carga pedidos, manda T1/T2/T3, despacha, da de baja (Greisy, Guada)
--    administracion -> confirma que el pago entró
--    consulta       -> solo mira
--  Estados del pedido (una sola columna, se cambia solo con fac_accion()):
--    facturado -> esperando_pago (T1) -> pago_informado -> listo (pago confirmado) -> despachado
--                                     \-> baja (T3 + nota de crédito)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Quién usa facturación y con qué rol
-- ---------------------------------------------------------------------
create table if not exists public.fac_usuarios (
  perfil_id  uuid primary key references public.perfiles(id) on delete cascade,
  rol        text not null check (rol in ('facturacion', 'administracion', 'consulta')),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Rol en facturación de quien está logueado: 'admin' | 'facturacion' | 'administracion' | 'consulta' | null
create or replace function public.fac_rol()
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.perfiles p
                 where p.id = public.mi_perfil_id() and p.activo and p.rol = 'superadmin') then 'admin'
    else (select u.rol from public.fac_usuarios u join public.perfiles p on p.id = u.perfil_id
          where u.perfil_id = public.mi_perfil_id() and u.activo and p.activo)
  end;
$$;

-- Nombres de las personas con acceso (para mostrar quién confirmó, despachó, etc.).
-- perfiles solo deja ver el propio a quien no es superadmin; esto expone nada más id y nombre.
create or replace function public.fac_personas()
returns table (id uuid, nombre text, email text, rol text, activo boolean, rol_rotulos text)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(nullif(p.nombre, ''), p.email), p.email,
         case when p.rol = 'superadmin' then 'admin' else u.rol end,
         p.activo and (p.rol = 'superadmin' or coalesce(u.activo, false)),
         p.rol
  from public.perfiles p
  left join public.fac_usuarios u on u.perfil_id = p.id
  where public.fac_rol() is not null
    and (p.rol = 'superadmin' or u.perfil_id is not null or public.fac_rol() = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 2) Listas de los desplegables (el transporte sale de la tabla de rótulos)
-- ---------------------------------------------------------------------
create table if not exists public.fac_opciones (
  id      bigint generated always as identity primary key,
  tipo    text not null check (tipo in ('facturo', 'armador', 'alias')),
  valor   text not null check (length(trim(valor)) > 0),
  orden   int not null default 100,
  activo  boolean not null default true,
  constraint fac_opciones_unico unique (tipo, valor)
);

insert into public.fac_opciones (tipo, valor, orden) values
  ('facturo', 'Greisy', 1), ('facturo', 'Guada', 2),
  ('armador', 'Jere', 1), ('armador', 'Elias', 2), ('armador', 'Silvana', 3), ('armador', 'Cintia', 4),
  ('armador', 'Agus', 5), ('armador', 'Juli', 6), ('armador', 'Fede', 7),
  ('alias', 'cindy.mayorista.gal', 1)
on conflict (tipo, valor) do nothing;

-- ---------------------------------------------------------------------
-- 3) Ajustes (plazos, ventanas de despacho, feriados)
-- ---------------------------------------------------------------------
create table if not exists public.fac_ajustes (
  clave           text primary key,
  valor           jsonb not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default public.mi_perfil_id() references public.perfiles(id) on delete set null
);

insert into public.fac_ajustes (clave, valor) values
  ('horas_t2', '48'::jsonb),                       -- horas hábiles desde el T1 hasta el aviso de T2
  ('horas_t3', '24'::jsonb),                       -- horas hábiles desde el T2 hasta el aviso de baja (T3)
  ('dias_no_habiles', '[0]'::jsonb),               -- 0 = domingo (como Date.getDay())
  ('feriados', '[]'::jsonb),                       -- ["2026-12-08", ...]
  ('ventanas', '["10:00", "15:00"]'::jsonb)        -- ventanas de despacho
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 4) Pedidos
-- ---------------------------------------------------------------------
create table if not exists public.fac_pedidos (
  id                  bigint generated always as identity primary key,
  numero              text not null default '',          -- n° de pedido (puede faltar)
  tipo                text not null default 'normal' check (tipo in ('normal', 'preventa', 'muestras')),
  fecha               date not null default (now() at time zone 'America/Argentina/Cordoba')::date,
  cliente_id          uuid references public.clientes(id) on delete set null,
  cliente             text not null check (length(trim(cliente)) > 0),
  telefono            text not null default '',
  transporte          text not null default '',
  facturo             text not null default '',
  armador             text not null default '',
  importe_1           numeric(14, 2) check (importe_1 >= 0),
  importe_2           numeric(14, 2) check (importe_2 >= 0),
  total               numeric(14, 2) generated always as (coalesce(importe_1, 0) + coalesce(importe_2, 0)) stored,
  alias_pago          text not null default '',
  faltantes           text not null default '',
  observaciones       text not null default '',
  estado              text not null default 'facturado'
                      check (estado in ('facturado', 'esperando_pago', 'pago_informado', 'listo', 'despachado', 'baja')),
  t1_en               timestamptz,
  t2_en               timestamptz,
  t3_en               timestamptz,
  pago_informado_en   timestamptz,
  pago_confirmado_en  timestamptz,
  pago_confirmado_por uuid references public.perfiles(id) on delete set null,
  despacho_fecha      date,
  despachado_en       timestamptz,
  despachado_por      uuid references public.perfiles(id) on delete set null,
  guia                text not null default '',
  remito_firmado      boolean not null default false,
  baja_en             timestamptz,
  baja_por            uuid references public.perfiles(id) on delete set null,
  nota_credito        text not null default '',
  motivo_baja         text not null default '',
  revisar             text not null default '',          -- aviso de datos dudosos (ej. al importar el Excel)
  creado_en           timestamptz not null default now(),
  creado_por          uuid default public.mi_perfil_id() references public.perfiles(id) on delete set null,
  actualizado_en      timestamptz not null default now(),
  actualizado_por     uuid default public.mi_perfil_id() references public.perfiles(id) on delete set null
);
create index if not exists fac_pedidos_estado_idx on public.fac_pedidos (estado);
create index if not exists fac_pedidos_fecha_idx on public.fac_pedidos (fecha desc);
create index if not exists fac_pedidos_numero_idx on public.fac_pedidos (numero);
create index if not exists fac_pedidos_cliente_idx on public.fac_pedidos (cliente_id);

-- Limpieza y controles antes de guardar (lo que no puede quedar mal tipeado)
create or replace function public.fac_pedidos_antes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Cordoba')::date;
begin
  new.numero := trim(new.numero);
  new.cliente := regexp_replace(trim(new.cliente), '\s+', ' ', 'g');
  new.telefono := trim(new.telefono);
  new.transporte := trim(new.transporte);
  new.facturo := trim(new.facturo);
  new.armador := trim(new.armador);
  new.alias_pago := trim(new.alias_pago);
  new.guia := trim(new.guia);
  new.nota_credito := trim(new.nota_credito);
  new.faltantes := trim(new.faltantes);
  new.observaciones := trim(new.observaciones);

  if tg_op = 'INSERT' or new.fecha is distinct from old.fecha then
    if new.fecha > v_hoy then raise exception 'La fecha del pedido no puede ser posterior a hoy.'; end if;
    if new.fecha < date '2020-01-01' then raise exception 'La fecha del pedido no es válida.'; end if;
  end if;
  if new.despacho_fecha is not null
     and (tg_op = 'INSERT' or new.despacho_fecha is distinct from old.despacho_fecha or new.fecha is distinct from old.fecha) then
    if new.despacho_fecha > v_hoy then raise exception 'La fecha de despacho no puede ser posterior a hoy.'; end if;
    if new.despacho_fecha < new.fecha then raise exception 'La fecha de despacho no puede ser anterior a la del pedido.'; end if;
  end if;
  if tg_op = 'UPDATE' and new.despacho_fecha is not null and new.despacho_fecha is distinct from old.despacho_fecha
     and new.estado <> 'despachado' then
    raise exception 'La fecha de despacho se carga al marcar el pedido como despachado.';
  end if;

  if tg_op = 'UPDATE' then
    new.actualizado_en := now();
    new.actualizado_por := public.mi_perfil_id();
  end if;
  return new;
end;
$$;

drop trigger if exists fac_pedidos_antes on public.fac_pedidos;
create trigger fac_pedidos_antes
  before insert or update on public.fac_pedidos
  for each row execute function public.fac_pedidos_antes();

-- ---------------------------------------------------------------------
-- 5) Historial: qué cambió, quién y cuándo (lo llena un trigger)
-- ---------------------------------------------------------------------
create table if not exists public.fac_historial (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null,
  accion     text not null,                  -- alta | cambio | borrado
  cambios    jsonb not null default '{}',    -- { campo: [antes, después] }
  por        uuid references public.perfiles(id) on delete set null,
  en         timestamptz not null default now()
);
create index if not exists fac_historial_pedido_idx on public.fac_historial (pedido_id, en);

create or replace function public.fac_pedidos_historial()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_antes jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_despues jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_cambios jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_despues) loop
      if k not in ('actualizado_en', 'actualizado_por', 'total') and v_antes -> k is distinct from v_despues -> k then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_array(v_antes -> k, v_despues -> k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return new; end if;
  elsif tg_op = 'DELETE' then
    v_cambios := v_antes;
  end if;
  insert into public.fac_historial (pedido_id, accion, cambios, por)
  values (coalesce(new.id, old.id),
          case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'borrado' end,
          v_cambios, public.mi_perfil_id());
  return coalesce(new, old);
end;
$$;

drop trigger if exists fac_pedidos_historial on public.fac_pedidos;
create trigger fac_pedidos_historial
  after insert or update or delete on public.fac_pedidos
  for each row execute function public.fac_pedidos_historial();

-- ---------------------------------------------------------------------
-- 6) Cambios de estado: siempre por acá (registra quién y cuándo)
--    acciones: t1, t2, informar_pago, confirmar_pago, rechazar_pago,
--              despachar {fecha, guia, remito_firmado}, baja {nota_credito, motivo},
--              volver (deshace el último paso)
-- ---------------------------------------------------------------------
create or replace function public.fac_accion(p_id bigint, p_accion text, p jsonb default '{}'::jsonb)
returns public.fac_pedidos
language plpgsql security definer set search_path = public
as $$
declare
  v public.fac_pedidos;
  v_rol text := public.fac_rol();
  v_yo uuid := public.mi_perfil_id();
  v_hoy date := (now() at time zone 'America/Argentina/Cordoba')::date;
  v_fecha date;
  v_factura constant text[] := array['admin', 'facturacion'];
  v_cobra constant text[] := array['admin', 'administracion'];
  v_necesita text[];
begin
  if v_rol is null then
    raise exception 'No tenés acceso a facturación.' using errcode = '42501';
  end if;
  p := coalesce(p, '{}'::jsonb);
  select * into v from public.fac_pedidos where id = p_id for update;
  if not found then raise exception 'El pedido no existe (puede que lo hayan borrado).'; end if;

  v_necesita := case
    when p_accion in ('confirmar_pago', 'rechazar_pago') then v_cobra
    when p_accion = 'volver' and v.estado = 'listo' then v_cobra
    else v_factura end;
  if not (v_rol = any (v_necesita)) then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;

  case p_accion
  when 't1' then
    if v.estado <> 'facturado' then raise exception 'El T1 se manda con el pedido recién facturado.'; end if;
    update public.fac_pedidos set estado = 'esperando_pago', t1_en = now() where id = p_id returning * into v;

  when 't2' then
    if v.estado <> 'esperando_pago' then raise exception 'El T2 es para pedidos que esperan el pago.'; end if;
    update public.fac_pedidos set t2_en = now() where id = p_id returning * into v;

  when 'informar_pago' then
    if v.estado not in ('facturado', 'esperando_pago') then raise exception 'Este pedido no está esperando el pago.'; end if;
    update public.fac_pedidos set estado = 'pago_informado', pago_informado_en = now() where id = p_id returning * into v;

  when 'confirmar_pago' then
    if v.estado not in ('facturado', 'esperando_pago', 'pago_informado') then
      raise exception 'Este pedido no tiene un pago para confirmar.';
    end if;
    update public.fac_pedidos
       set estado = 'listo', pago_informado_en = coalesce(pago_informado_en, now()),
           pago_confirmado_en = now(), pago_confirmado_por = v_yo
     where id = p_id returning * into v;

  when 'rechazar_pago' then
    if v.estado <> 'pago_informado' then raise exception 'Este pedido no tiene un pago informado.'; end if;
    update public.fac_pedidos
       set estado = case when t1_en is null then 'facturado' else 'esperando_pago' end, pago_informado_en = null
     where id = p_id returning * into v;

  when 'despachar' then
    if not (v.estado = 'listo' or (v_rol = 'admin' and v.estado in ('facturado', 'esperando_pago', 'pago_informado'))) then
      raise exception 'Solo se despachan pedidos con el pago confirmado.';
    end if;
    begin
      v_fecha := coalesce(nullif(p ->> 'fecha', '')::date, v_hoy);
    exception when others then
      raise exception 'La fecha de despacho no es válida.';
    end;
    update public.fac_pedidos
       set estado = 'despachado', despacho_fecha = v_fecha, despachado_en = now(), despachado_por = v_yo,
           guia = coalesce(nullif(trim(p ->> 'guia'), ''), guia),
           remito_firmado = coalesce((p ->> 'remito_firmado')::boolean, remito_firmado)
     where id = p_id returning * into v;

  when 'baja' then
    if v.estado not in ('facturado', 'esperando_pago', 'pago_informado') then
      raise exception 'Solo se dan de baja pedidos sin pago confirmado ni despacho.';
    end if;
    update public.fac_pedidos
       set estado = 'baja', t3_en = now(), baja_en = now(), baja_por = v_yo,
           nota_credito = coalesce(nullif(trim(p ->> 'nota_credito'), ''), nota_credito),
           motivo_baja = coalesce(trim(p ->> 'motivo'), '')
     where id = p_id returning * into v;

  when 'volver' then
    case v.estado
    when 'facturado' then
      raise exception 'No hay ningún paso para deshacer.';
    when 'esperando_pago' then
      if v.t2_en is not null then
        update public.fac_pedidos set t2_en = null where id = p_id returning * into v;
      else
        update public.fac_pedidos set estado = 'facturado', t1_en = null where id = p_id returning * into v;
      end if;
    when 'pago_informado' then
      update public.fac_pedidos
         set estado = case when t1_en is null then 'facturado' else 'esperando_pago' end, pago_informado_en = null
       where id = p_id returning * into v;
    when 'listo' then
      update public.fac_pedidos set estado = 'pago_informado', pago_confirmado_en = null, pago_confirmado_por = null
       where id = p_id returning * into v;
    when 'despachado' then
      update public.fac_pedidos
         set estado = case when pago_confirmado_en is not null then 'listo'
                           when pago_informado_en is not null then 'pago_informado'
                           when t1_en is not null then 'esperando_pago' else 'facturado' end,
             despacho_fecha = null, despachado_en = null, despachado_por = null
       where id = p_id returning * into v;
    when 'baja' then
      update public.fac_pedidos
         set estado = case when pago_informado_en is not null then 'pago_informado'
                           when t1_en is not null then 'esperando_pago' else 'facturado' end,
             t3_en = null, baja_en = null, baja_por = null, motivo_baja = ''
       where id = p_id returning * into v;
    end case;

  else
    raise exception 'Acción desconocida: %', p_accion;
  end case;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Permisos (RLS). Las funciones de rol van envueltas en (select ...)
--    para que Postgres las calcule una vez por consulta y no por fila.
-- ---------------------------------------------------------------------
alter table public.fac_usuarios  enable row level security;
alter table public.fac_opciones  enable row level security;
alter table public.fac_ajustes   enable row level security;
alter table public.fac_pedidos   enable row level security;
alter table public.fac_historial enable row level security;

revoke all on public.fac_usuarios, public.fac_opciones, public.fac_ajustes, public.fac_pedidos, public.fac_historial
  from anon, authenticated;

grant select, insert, update, delete on public.fac_usuarios to authenticated;
grant select, insert, update on public.fac_opciones to authenticated;
grant select, update on public.fac_ajustes to authenticated;
grant select, delete on public.fac_pedidos to authenticated;
grant select on public.fac_historial to authenticated;
-- Pedidos: se cargan y corrigen los datos; el estado y sus fechas cambian solo con fac_accion()
grant insert (numero, tipo, fecha, cliente_id, cliente, telefono, transporte, facturo, armador, importe_1, importe_2,
              alias_pago, faltantes, observaciones, guia, nota_credito, remito_firmado, revisar)
  on public.fac_pedidos to authenticated;
grant update (numero, tipo, fecha, cliente_id, cliente, telefono, transporte, facturo, armador, importe_1, importe_2,
              alias_pago, faltantes, observaciones, guia, nota_credito, remito_firmado, despacho_fecha, revisar)
  on public.fac_pedidos to authenticated;

drop policy if exists fac_usuarios_select on public.fac_usuarios;
create policy fac_usuarios_select on public.fac_usuarios for select to authenticated
  using (perfil_id = (select public.mi_perfil_id()) or (select public.fac_rol()) = 'admin');
drop policy if exists fac_usuarios_insert on public.fac_usuarios;
create policy fac_usuarios_insert on public.fac_usuarios for insert to authenticated
  with check ((select public.fac_rol()) = 'admin');
drop policy if exists fac_usuarios_update on public.fac_usuarios;
create policy fac_usuarios_update on public.fac_usuarios for update to authenticated
  using ((select public.fac_rol()) = 'admin') with check ((select public.fac_rol()) = 'admin');
drop policy if exists fac_usuarios_delete on public.fac_usuarios;
create policy fac_usuarios_delete on public.fac_usuarios for delete to authenticated
  using ((select public.fac_rol()) = 'admin');

drop policy if exists fac_opciones_select on public.fac_opciones;
create policy fac_opciones_select on public.fac_opciones for select to authenticated
  using ((select public.fac_rol()) is not null);
drop policy if exists fac_opciones_insert on public.fac_opciones;
create policy fac_opciones_insert on public.fac_opciones for insert to authenticated
  with check ((select public.fac_rol()) = 'admin');
drop policy if exists fac_opciones_update on public.fac_opciones;
create policy fac_opciones_update on public.fac_opciones for update to authenticated
  using ((select public.fac_rol()) = 'admin') with check ((select public.fac_rol()) = 'admin');

drop policy if exists fac_ajustes_select on public.fac_ajustes;
create policy fac_ajustes_select on public.fac_ajustes for select to authenticated
  using ((select public.fac_rol()) is not null);
drop policy if exists fac_ajustes_update on public.fac_ajustes;
create policy fac_ajustes_update on public.fac_ajustes for update to authenticated
  using ((select public.fac_rol()) = 'admin') with check ((select public.fac_rol()) = 'admin');

drop policy if exists fac_pedidos_select on public.fac_pedidos;
create policy fac_pedidos_select on public.fac_pedidos for select to authenticated
  using ((select public.fac_rol()) is not null);
drop policy if exists fac_pedidos_insert on public.fac_pedidos;
create policy fac_pedidos_insert on public.fac_pedidos for insert to authenticated
  with check ((select public.fac_rol()) in ('admin', 'facturacion'));
drop policy if exists fac_pedidos_update on public.fac_pedidos;
create policy fac_pedidos_update on public.fac_pedidos for update to authenticated
  using ((select public.fac_rol()) in ('admin', 'facturacion'))
  with check ((select public.fac_rol()) in ('admin', 'facturacion'));
-- Borrar: el admin siempre; quien lo cargó, dentro de las 2 horas (para corregir un error de carga)
drop policy if exists fac_pedidos_delete on public.fac_pedidos;
create policy fac_pedidos_delete on public.fac_pedidos for delete to authenticated
  using ((select public.fac_rol()) = 'admin'
         or ((select public.fac_rol()) = 'facturacion' and creado_por = (select public.mi_perfil_id())
             and creado_en > now() - interval '2 hours'));

drop policy if exists fac_historial_select on public.fac_historial;
create policy fac_historial_select on public.fac_historial for select to authenticated
  using ((select public.fac_rol()) is not null);

-- Funciones: nada para quien no inició sesión
revoke execute on function public.fac_rol(), public.fac_personas(), public.fac_accion(bigint, text, jsonb),
  public.fac_pedidos_antes(), public.fac_pedidos_historial() from anon, public;
grant execute on function public.fac_rol(), public.fac_personas(), public.fac_accion(bigint, text, jsonb)
  to authenticated;
