-- =====================================================================
--  Facturación y despacho: Administración también carga pedidos.
--  Puede dar de alta pedidos, corregir sus datos y borrar los que cargó
--  en las últimas 2 horas (siempre en sus sucursales). Los cambios de
--  estado de facturación (T1, T2, pago informado, despacho, baja) siguen
--  siendo de Facturación: fac_accion no cambia.
--
--  Correr DESPUÉS de 20261118100000_sucursales.sql. Se puede correr dos veces.
-- =====================================================================

drop policy if exists fac_pedidos_insert on public.fac_pedidos;
create policy fac_pedidos_insert on public.fac_pedidos for insert to authenticated
  with check ((select public.fac_rol()) in ('admin', 'facturacion', 'administracion')
              and sucursal = any ((select public.fac_mis_sucursales())::text[]));

drop policy if exists fac_pedidos_update on public.fac_pedidos;
create policy fac_pedidos_update on public.fac_pedidos for update to authenticated
  using ((select public.fac_rol()) in ('admin', 'facturacion', 'administracion')
         and sucursal = any ((select public.fac_mis_sucursales())::text[]))
  with check ((select public.fac_rol()) in ('admin', 'facturacion', 'administracion')
              and sucursal = any ((select public.fac_mis_sucursales())::text[]));

-- Borrar: el admin siempre; quien lo cargó (facturación o administración), dentro de las 2 horas
drop policy if exists fac_pedidos_delete on public.fac_pedidos;
create policy fac_pedidos_delete on public.fac_pedidos for delete to authenticated
  using (sucursal = any ((select public.fac_mis_sucursales())::text[])
         and ((select public.fac_rol()) = 'admin'
              or ((select public.fac_rol()) in ('facturacion', 'administracion')
                  and creado_por = (select public.mi_perfil_id())
                  and creado_en > now() - interval '2 hours')));
