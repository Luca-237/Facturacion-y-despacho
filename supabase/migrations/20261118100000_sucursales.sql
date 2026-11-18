-- =====================================================================
--  Facturación y despacho: pedidos separados por sucursal
--  (Casa Central de Villa María y Córdoba Capital).
--
--  - fac_sucursales: las sucursales y lo propio de cada una (ventanas de despacho).
--  - fac_pedidos.sucursal: a qué sucursal pertenece cada pedido (los que ya había
--    quedan en Casa Central).
--  - fac_usuarios.sucursales: qué sucursales ve cada persona. El admin (superadmin
--    de rótulos) ve todas. La base no deja ver, cargar ni cambiar pedidos de otra.
--  - fac_opciones.sucursal: quién factura, armadores y alias van por sucursal.
--  - Plazos de T2/T3, días no hábiles y feriados siguen comunes (fac_ajustes).
--
--  Correr DESPUÉS de 20261117500000_facturacion.sql. Se puede correr dos veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Sucursales
-- ---------------------------------------------------------------------
create table if not exists public.fac_sucursales (
  clave     text primary key check (clave ~ '^[a-z][a-z0-9_]*$'),
  nombre    text not null check (length(trim(nombre)) > 0),
  orden     int not null default 100,
  activa    boolean not null default true,
  ventanas  jsonb not null default '["10:00", "15:00"]'::jsonb   -- ventanas de despacho de esa sucursal
);

-- Las ventanas que ya estaban cargadas pasan a las dos sucursales
insert into public.fac_sucursales (clave, nombre, orden, ventanas)
select v.clave, v.nombre, v.orden,
       coalesce((select a.valor from public.fac_ajustes a where a.clave = 'ventanas'), '["10:00", "15:00"]'::jsonb)
from (values ('central', 'Casa Central (Villa María)', 1), ('cordoba', 'Córdoba Capital', 2)) as v(clave, nombre, orden)
on conflict (clave) do nothing;
delete from public.fac_ajustes where clave = 'ventanas';

-- ---------------------------------------------------------------------
-- 2) Sucursal de cada pedido (los anteriores: Casa Central)
-- ---------------------------------------------------------------------
alter table public.fac_pedidos add column if not exists sucursal text;
update public.fac_pedidos set sucursal = 'central' where sucursal is null;
alter table public.fac_pedidos alter column sucursal set not null;
-- Compatibilidad: la versión anterior de la página no manda la sucursal; mientras se publica
-- la nueva, lo que cargue queda en Casa Central. La página nueva la manda siempre.
alter table public.fac_pedidos alter column sucursal set default 'central';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fac_pedidos_sucursal_fkey') then
    alter table public.fac_pedidos add constraint fac_pedidos_sucursal_fkey
      foreign key (sucursal) references public.fac_sucursales(clave) on update cascade;
  end if;
end $$;
create index if not exists fac_pedidos_sucursal_idx on public.fac_pedidos (sucursal, estado);

-- ---------------------------------------------------------------------
-- 3) Sucursales de cada persona (las que ya tenían rol: Casa Central)
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'fac_usuarios' and column_name = 'sucursales') then
    alter table public.fac_usuarios add column sucursales text[] not null default '{}';
    update public.fac_usuarios set sucursales = '{central}';   -- solo la primera vez (si se vuelve a correr, no pisa lo asignado)
  end if;
end $$;

-- Sucursales que puede ver quien está logueado (el admin, todas las activas)
create or replace function public.fac_mis_sucursales()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when public.fac_rol() is null then '{}'::text[]
    when public.fac_rol() = 'admin' then coalesce((select array_agg(s.clave order by s.orden) from public.fac_sucursales s where s.activa), '{}')
    else coalesce((select array_agg(s.clave order by s.orden) from public.fac_sucursales s
                   join public.fac_usuarios u on s.clave = any (u.sucursales)
                   where u.perfil_id = public.mi_perfil_id() and s.activa), '{}')
  end;
$$;

-- ---------------------------------------------------------------------
-- 4) Listas por sucursal (las que había: Casa Central)
-- ---------------------------------------------------------------------
alter table public.fac_opciones add column if not exists sucursal text;
update public.fac_opciones set sucursal = 'central' where sucursal is null;
alter table public.fac_opciones alter column sucursal set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fac_opciones_sucursal_fkey') then
    alter table public.fac_opciones add constraint fac_opciones_sucursal_fkey
      foreign key (sucursal) references public.fac_sucursales(clave) on update cascade;
  end if;
end $$;
alter table public.fac_opciones drop constraint if exists fac_opciones_unico;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fac_opciones_unico_sucursal') then
    alter table public.fac_opciones add constraint fac_opciones_unico_sucursal unique (sucursal, tipo, valor);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Personas: ahora con sus sucursales
-- ---------------------------------------------------------------------
drop function if exists public.fac_personas();
create function public.fac_personas()
returns table (id uuid, nombre text, email text, rol text, activo boolean, rol_rotulos text, sucursales text[])
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(nullif(p.nombre, ''), p.email), p.email,
         case when p.rol = 'superadmin' then 'admin' else u.rol end,
         p.activo and (p.rol = 'superadmin' or coalesce(u.activo, false)),
         p.rol,
         case when p.rol = 'superadmin' then (select array_agg(s.clave order by s.orden) from public.fac_sucursales s where s.activa)
              else coalesce(u.sucursales, '{}') end
  from public.perfiles p
  left join public.fac_usuarios u on u.perfil_id = p.id
  where public.fac_rol() is not null
    and (p.rol = 'superadmin' or u.perfil_id is not null or public.fac_rol() = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 6) Cambios de estado: solo en pedidos de mis sucursales
--    (fac_accion corre con permisos de dueño: el control va acá adentro)
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
  if not found or not (v.sucursal = any (public.fac_mis_sucursales())) then
    raise exception 'El pedido no existe (puede que lo hayan borrado).';
  end if;

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
-- 7) Permisos
-- ---------------------------------------------------------------------
alter table public.fac_sucursales enable row level security;
revoke all on public.fac_sucursales from anon, authenticated;
grant select, update on public.fac_sucursales to authenticated;

drop policy if exists fac_sucursales_select on public.fac_sucursales;
create policy fac_sucursales_select on public.fac_sucursales for select to authenticated
  using ((select public.fac_rol()) is not null);
drop policy if exists fac_sucursales_update on public.fac_sucursales;
create policy fac_sucursales_update on public.fac_sucursales for update to authenticated
  using ((select public.fac_rol()) = 'admin') with check ((select public.fac_rol()) = 'admin');

-- La sucursal del pedido se carga al crearlo y se puede corregir (solo entre mis sucursales)
grant insert (sucursal), update (sucursal) on public.fac_pedidos to authenticated;

drop policy if exists fac_pedidos_select on public.fac_pedidos;
create policy fac_pedidos_select on public.fac_pedidos for select to authenticated
  using ((select public.fac_rol()) is not null and sucursal = any ((select public.fac_mis_sucursales())::text[]));
drop policy if exists fac_pedidos_insert on public.fac_pedidos;
create policy fac_pedidos_insert on public.fac_pedidos for insert to authenticated
  with check ((select public.fac_rol()) in ('admin', 'facturacion') and sucursal = any ((select public.fac_mis_sucursales())::text[]));
drop policy if exists fac_pedidos_update on public.fac_pedidos;
create policy fac_pedidos_update on public.fac_pedidos for update to authenticated
  using ((select public.fac_rol()) in ('admin', 'facturacion') and sucursal = any ((select public.fac_mis_sucursales())::text[]))
  with check ((select public.fac_rol()) in ('admin', 'facturacion') and sucursal = any ((select public.fac_mis_sucursales())::text[]));
drop policy if exists fac_pedidos_delete on public.fac_pedidos;
create policy fac_pedidos_delete on public.fac_pedidos for delete to authenticated
  using (sucursal = any ((select public.fac_mis_sucursales())::text[])
         and ((select public.fac_rol()) = 'admin'
              or ((select public.fac_rol()) = 'facturacion' and creado_por = (select public.mi_perfil_id())
                  and creado_en > now() - interval '2 hours')));

-- Historial: solo de los pedidos que se pueden ver
drop policy if exists fac_historial_select on public.fac_historial;
create policy fac_historial_select on public.fac_historial for select to authenticated
  using ((select public.fac_rol()) = 'admin'
         or exists (select 1 from public.fac_pedidos p where p.id = fac_historial.pedido_id));

revoke execute on function public.fac_mis_sucursales(), public.fac_personas(), public.fac_accion(bigint, text, jsonb) from anon, public;
grant execute on function public.fac_mis_sucursales(), public.fac_personas(), public.fac_accion(bigint, text, jsonb) to authenticated;
