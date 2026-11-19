-- =====================================================================
--  Facturación y despacho: Facturación elimina pedidos de sus sucursales.
--  Pedido de Luca (19/11/2026): Greisy limpia la planilla seleccionando
--  varios pedidos y usando "Eliminar". Toda Facturación puede borrar
--  cualquier pedido de sus sucursales; Administración sigue pudiendo borrar
--  solo lo que cargó en las últimas 2 horas; el admin, todo.
--  fac_restaurar(id) vuelve a crear un pedido borrado tal como estaba
--  (sale del historial), para el "Deshacer".
--
--  Correr DESPUÉS de 20261118300000_facturacion_confirma_pagos.sql. Se puede correr dos veces.
-- =====================================================================

drop policy if exists fac_pedidos_delete on public.fac_pedidos;
create policy fac_pedidos_delete on public.fac_pedidos for delete to authenticated
  using (sucursal = any ((select public.fac_mis_sucursales())::text[])
         and ((select public.fac_rol()) in ('admin', 'facturacion')
              or ((select public.fac_rol()) = 'administracion'
                  and creado_por = (select public.mi_perfil_id())
                  and creado_en > now() - interval '2 hours')));

-- Restaura un pedido borrado con su mismo número interno, estado y fechas
create or replace function public.fac_restaurar(p_id bigint)
returns public.fac_pedidos
language plpgsql security definer set search_path = public
as $$
declare
  v_rol text := public.fac_rol();
  v_datos jsonb;
  v_columnas text;
  v public.fac_pedidos;
begin
  if v_rol is null or v_rol not in ('admin', 'facturacion', 'administracion') then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  if exists (select 1 from public.fac_pedidos where id = p_id) then
    raise exception 'El pedido ya existe.';
  end if;
  select h.cambios into v_datos from public.fac_historial h
   where h.pedido_id = p_id and h.accion = 'borrado'
   order by h.en desc, h.id desc limit 1;
  if v_datos is null then raise exception 'No se encontró el pedido borrado.'; end if;
  if not ((v_datos ->> 'sucursal') = any (public.fac_mis_sucursales())) then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  -- Todas las columnas menos las calculadas (total)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_columnas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'fac_pedidos' and is_generated = 'NEVER';
  execute format('insert into public.fac_pedidos (%s) overriding system value select %s from jsonb_populate_record(null::public.fac_pedidos, $1)',
                 v_columnas, v_columnas) using v_datos;
  select * into v from public.fac_pedidos where id = p_id;
  return v;
end;
$$;

revoke execute on function public.fac_restaurar(bigint) from anon, public;
grant execute on function public.fac_restaurar(bigint) to authenticated;
