-- =====================================================================
--  Facturación y despacho: Facturación también confirma pagos.
--  Pedido de Luca (18/11/2026): Greisy (y toda Facturación) confirma y rechaza
--  pagos como Administración, y puede deshacer una confirmación (volver de
--  "Listo para despachar"). El resto de fac_accion queda igual que en
--  20261118100000_sucursales.sql (control de sucursales incluido).
--
--  Correr DESPUÉS de 20261118200000_administracion_carga.sql. Se puede correr dos veces.
-- =====================================================================

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
  v_cobra constant text[] := array['admin', 'administracion', 'facturacion'];   -- confirmar / rechazar pagos
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

revoke execute on function public.fac_accion(bigint, text, jsonb) from anon, public;
grant execute on function public.fac_accion(bigint, text, jsonb) to authenticated;
