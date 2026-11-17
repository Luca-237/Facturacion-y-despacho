// =====================================================================
//  Modo de prueba sin base de datos (solo en la PC): index.html?demo
//  ?demo=facturacion | administracion | consulta  (sin valor = admin)
//  Reemplaza R.api por una copia en memoria con las mismas reglas que
//  la base (supabase/migrations/20261117500000_facturacion.sql).
//  Los datos son inventados y se pierden al recargar.
// =====================================================================
(function (R) {
  const rolDemo = (new URLSearchParams(location.search).get("demo") || "admin").replace(/[^a-z]/g, "") || "admin";
  window.FAC_CONFIG = { ...(window.FAC_CONFIG || {}), clerkPublishableKey: "" };
  const banner = document.getElementById("banner-demo");
  if (banner) banner.hidden = false;

  const ZONA_MS = 3 * 3600000;
  const hoyIso = () => new Date(Date.now() - ZONA_MS).toISOString().slice(0, 10);
  const haceHoras = h => new Date(Date.now() - h * 3600000).toISOString();
  const diaHace = d => new Date(Date.now() - ZONA_MS - d * 86400000).toISOString().slice(0, 10);
  const esperar = (ms = 120) => new Promise(ok => setTimeout(ok, ms));
  const copia = x => JSON.parse(JSON.stringify(x));

  const PERSONAS = [
    { id: "p-luca", nombre: "Luca", email: "luca@rotulos.cindymayorista.com.ar", rol: "admin", activo: true, rol_rotulos: "superadmin" },
    { id: "p-greisy", nombre: "Greisy", email: "greisy@rotulos.cindymayorista.com.ar", rol: "facturacion", activo: true, rol_rotulos: "operador" },
    { id: "p-guada", nombre: "Guada", email: "guada@rotulos.cindymayorista.com.ar", rol: "facturacion", activo: true, rol_rotulos: "operador" },
    { id: "p-admin", nombre: "Administración", email: "administracion@rotulos.cindymayorista.com.ar", rol: "administracion", activo: true, rol_rotulos: "operador" },
    { id: "p-facu", nombre: "Facu", email: "facu@rotulos.cindymayorista.com.ar", rol: null, activo: false, rol_rotulos: "operador" },
  ];
  const yo = PERSONAS.find(p => p.rol === rolDemo) || { ...PERSONAS[0], rol: rolDemo === "admin" ? "admin" : rolDemo };
  const rol = () => yo.rol;

  let sec = 1, secH = 1, secO = 1;
  const opciones = [];
  [["facturo", ["Greisy", "Guada"]], ["armador", ["Jere", "Elias", "Silvana", "Cintia", "Agus", "Juli", "Fede"]], ["alias", ["cindy.mayorista.gal"]]]
    .forEach(([tipo, vs]) => vs.forEach((valor, i) => opciones.push({ id: secO++, tipo, valor, orden: i + 1, activo: true })));
  const transportes = ["VIA CARGO", "CREDIFIN", "BUSPACK", "PRIVITERA", "COMISIONISTA", "COMISIONISTA-DESDE CBA", "INTERPROVINCIAL", "ALPHA",
    "TRANSPORTE PAMPERO", "INTEGRAL PACK", "TIM-CAR", "ENTREGA A DOMICILIO", "RETIRA EN LOCAL"].map((nombre, i) => ({ id: i + 1, nombre, orden: i + 1, activo: true }));
  let ajustes = { horas_t2: 48, horas_t3: 24, dias_no_habiles: [0], feriados: [], ventanas: ["10:00", "15:00"] };
  const clientes = [
    ["BAZAR LOS ALAMOS", "0353 15 412-3456", "VIA CARGO", "Villa María"], ["DISTRIBUIDORA EL SOL", "3515551234", "CREDIFIN", "Córdoba"],
    ["LIBRERIA PUNTO Y COMA", "", "BUSPACK", "Río Cuarto"], ["REGALERIA LA ESQUINA", "0358 15 466-1122", "COMISIONISTA", "Río Cuarto"],
    ["MARROQUINERIA DEL CENTRO", "3534999888", "RETIRA EN LOCAL", "Villa María"], ["JUGUETERIA PEQUES", "011 15 5555 1234", "VIA CARGO", "CABA"],
    ["KIOSCO DON PEPE", "3571 445566", "PRIVITERA", "Río Tercero"], ["TIENDA MAGNOLIA", "", "INTEGRAL PACK", "San Francisco"],
  ].map(([nombre, tel, transporte, ciudad], i) => ({ id: "c" + i, nombre, tel, transporte, ciudad, provincia: "Córdoba" }));

  const pedidos = [];
  const historial = [];
  function nuevo(datos) {
    const p = {
      id: sec++, numero: "", tipo: "normal", fecha: hoyIso(), cliente_id: null, cliente: "", telefono: "", transporte: "", facturo: "", armador: "",
      importe_1: null, importe_2: null, total: 0, alias_pago: "", faltantes: "", observaciones: "", estado: "facturado",
      t1_en: null, t2_en: null, t3_en: null, pago_informado_en: null, pago_confirmado_en: null, pago_confirmado_por: null,
      despacho_fecha: null, despachado_en: null, despachado_por: null, guia: "", remito_firmado: false, baja_en: null, baja_por: null,
      nota_credito: "", motivo_baja: "", revisar: "", creado_en: new Date().toISOString(), creado_por: yo.id,
      actualizado_en: new Date().toISOString(), actualizado_por: yo.id, ...datos,
    };
    p.total = (Number(p.importe_1) || 0) + (Number(p.importe_2) || 0);
    return p;
  }
  // Datos de ejemplo en todos los estados
  const ej = (c, extra) => {
    const cl = clientes[c];
    const p = nuevo({ numero: String(11860 + sec), cliente: cl.nombre, cliente_id: cl.id, telefono: cl.tel, transporte: cl.transporte,
      facturo: sec % 3 ? "Greisy" : "Guada", alias_pago: "cindy.mayorista.gal", importe_1: 120000 + sec * 37150.5, importe_2: sec % 2 ? 80000 + sec * 9100 : null, creado_por: "p-greisy", ...extra });
    p.total = (Number(p.importe_1) || 0) + (Number(p.importe_2) || 0);
    pedidos.push(p);
    historial.push({ id: secH++, pedido_id: p.id, accion: "alta", cambios: {}, por: "p-greisy", en: p.creado_en });
  };
  ej(0, { creado_en: haceHoras(1) });
  ej(1, { creado_en: haceHoras(6), fecha: diaHace(0) });
  ej(2, { estado: "esperando_pago", creado_en: haceHoras(20), t1_en: haceHoras(19), fecha: diaHace(1) });
  ej(3, { estado: "esperando_pago", creado_en: haceHoras(80), t1_en: haceHoras(78), fecha: diaHace(4), faltantes: "2 billeteras ref. 205" });
  ej(4, { estado: "esperando_pago", creado_en: haceHoras(110), t1_en: haceHoras(108), t2_en: haceHoras(30), fecha: diaHace(5) });
  ej(5, { estado: "pago_informado", creado_en: haceHoras(30), t1_en: haceHoras(29), pago_informado_en: haceHoras(2), fecha: diaHace(1) });
  ej(6, { estado: "listo", creado_en: haceHoras(26), t1_en: haceHoras(25), pago_informado_en: haceHoras(5), pago_confirmado_en: haceHoras(3), pago_confirmado_por: "p-admin", fecha: diaHace(1), observaciones: "Llamar antes de despachar" });
  ej(7, { estado: "listo", creado_en: haceHoras(50), t1_en: haceHoras(49), pago_informado_en: haceHoras(20), pago_confirmado_en: haceHoras(4), pago_confirmado_por: "p-admin", fecha: diaHace(2) });
  ej(0, { estado: "despachado", creado_en: haceHoras(48), t1_en: haceHoras(47), pago_informado_en: haceHoras(30), pago_confirmado_en: haceHoras(28), pago_confirmado_por: "p-admin", despacho_fecha: hoyIso(), despachado_en: haceHoras(1), despachado_por: "p-greisy", guia: "3600-12345678", fecha: diaHace(2) });
  ej(1, { estado: "baja", creado_en: haceHoras(200), t1_en: haceHoras(199), t2_en: haceHoras(140), t3_en: haceHoras(100), baja_en: haceHoras(100), baja_por: "p-greisy", motivo_baja: "Sin respuesta al T2", fecha: diaHace(8) });
  for (let i = 0; i < 18; i++) {
    ej(i % clientes.length, { estado: "despachado", creado_en: haceHoras(100 + i * 30), t1_en: haceHoras(99 + i * 30), pago_informado_en: haceHoras(80 + i * 30), pago_confirmado_en: haceHoras(78 + i * 30), pago_confirmado_por: "p-admin", despacho_fecha: diaHace(3 + i), despachado_en: haceHoras(70 + i * 30), despachado_por: "p-greisy", fecha: diaHace(4 + i), guia: i % 4 ? "36" + (10000000 + i * 7919) : "" });
  }
  pedidos[pedidos.length - 1].revisar = "Importe ilegible en el Excel: \"$ 300,727,35\"";

  const error = m => { throw new Error(m); };
  const puedeCargar = () => ["admin", "facturacion"].includes(rol());
  const puedeCobrar = () => ["admin", "administracion"].includes(rol());
  const registrar = (antes, despues) => {
    const cambios = {};
    Object.keys(despues).forEach(k => { if (!["actualizado_en", "actualizado_por", "total"].includes(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k])) cambios[k] = [antes[k] ?? null, despues[k] ?? null]; });
    if (Object.keys(cambios).length) historial.push({ id: secH++, pedido_id: despues.id, accion: "cambio", cambios, por: yo.id, en: new Date().toISOString() });
  };
  const limpiar = p => {
    ["numero", "cliente", "telefono", "transporte", "facturo", "armador", "alias_pago", "guia", "nota_credito", "faltantes", "observaciones"]
      .forEach(k => { if (typeof p[k] === "string") p[k] = p[k].trim(); });
    p.cliente = String(p.cliente || "").replace(/\s+/g, " ");
    if (!p.cliente) error("Falta el cliente.");
    if (p.fecha > hoyIso()) error("La fecha del pedido no puede ser posterior a hoy.");
    if (p.importe_1 < 0 || p.importe_2 < 0) error("El importe no puede ser negativo.");
    if (p.despacho_fecha && (p.despacho_fecha > hoyIso() || p.despacho_fecha < p.fecha)) error("La fecha de despacho tiene que estar entre la del pedido y hoy.");
    p.total = (Number(p.importe_1) || 0) + (Number(p.importe_2) || 0);
    return p;
  };
  const buscar = id => pedidos.find(p => p.id === id) || error("El pedido no existe (puede que lo hayan borrado).");

  function accion(id, a, d = {}) {
    const p = buscar(id), antes = copia(p), ahora = new Date().toISOString();
    const cobro = ["confirmar_pago", "rechazar_pago"].includes(a) || (a === "volver" && p.estado === "listo");
    if (cobro ? !puedeCobrar() : !puedeCargar()) error("No tenés permiso para hacer esto.");
    const abierto = ["facturado", "esperando_pago", "pago_informado"].includes(p.estado);
    switch (a) {
      case "t1": if (p.estado !== "facturado") error("El T1 se manda con el pedido recién facturado."); Object.assign(p, { estado: "esperando_pago", t1_en: ahora }); break;
      case "t2": if (p.estado !== "esperando_pago") error("El T2 es para pedidos que esperan el pago."); p.t2_en = ahora; break;
      case "informar_pago": if (!["facturado", "esperando_pago"].includes(p.estado)) error("Este pedido no está esperando el pago."); Object.assign(p, { estado: "pago_informado", pago_informado_en: ahora }); break;
      case "confirmar_pago": if (!abierto) error("Este pedido no tiene un pago para confirmar."); Object.assign(p, { estado: "listo", pago_informado_en: p.pago_informado_en || ahora, pago_confirmado_en: ahora, pago_confirmado_por: yo.id }); break;
      case "rechazar_pago": if (p.estado !== "pago_informado") error("Este pedido no tiene un pago informado."); Object.assign(p, { estado: p.t1_en ? "esperando_pago" : "facturado", pago_informado_en: null }); break;
      case "despachar": {
        if (!(p.estado === "listo" || (rol() === "admin" && abierto))) error("Solo se despachan pedidos con el pago confirmado.");
        const f = d.fecha || hoyIso();
        if (f > hoyIso()) error("La fecha de despacho no puede ser posterior a hoy.");
        if (f < p.fecha) error("La fecha de despacho no puede ser anterior a la del pedido.");
        Object.assign(p, { estado: "despachado", despacho_fecha: f, despachado_en: ahora, despachado_por: yo.id, guia: (d.guia || "").trim() || p.guia, remito_firmado: d.remito_firmado ?? p.remito_firmado });
        break;
      }
      case "baja": if (!abierto) error("Solo se dan de baja pedidos sin pago confirmado ni despacho.");
        Object.assign(p, { estado: "baja", t3_en: ahora, baja_en: ahora, baja_por: yo.id, nota_credito: (d.nota_credito || "").trim() || p.nota_credito, motivo_baja: (d.motivo || "").trim() }); break;
      case "volver":
        if (p.estado === "facturado") error("No hay ningún paso para deshacer.");
        if (p.estado === "esperando_pago") { if (p.t2_en) p.t2_en = null; else Object.assign(p, { estado: "facturado", t1_en: null }); }
        else if (p.estado === "pago_informado") Object.assign(p, { estado: p.t1_en ? "esperando_pago" : "facturado", pago_informado_en: null });
        else if (p.estado === "listo") Object.assign(p, { estado: "pago_informado", pago_confirmado_en: null, pago_confirmado_por: null });
        else if (p.estado === "despachado") Object.assign(p, { estado: p.pago_confirmado_en ? "listo" : p.pago_informado_en ? "pago_informado" : p.t1_en ? "esperando_pago" : "facturado", despacho_fecha: null, despachado_en: null, despachado_por: null });
        else if (p.estado === "baja") Object.assign(p, { estado: p.pago_informado_en ? "pago_informado" : p.t1_en ? "esperando_pago" : "facturado", t3_en: null, baja_en: null, baja_por: null, motivo_baja: "" });
        break;
      default: error("Acción desconocida: " + a);
    }
    p.actualizado_en = ahora; p.actualizado_por = yo.id;
    registrar(antes, p);
    return copia(p);
  }

  const CAMPOS_EDITABLES = new Set(["numero", "tipo", "fecha", "cliente_id", "cliente", "telefono", "transporte", "facturo", "armador", "importe_1", "importe_2",
    "alias_pago", "faltantes", "observaciones", "guia", "nota_credito", "remito_firmado", "despacho_fecha", "revisar"]);

  R.api = {
    configurado: () => true,
    iniciar() {},
    auth: {
      via: () => "propio",
      async ingresar() {}, async salir() {}, async sesion() { return true; }, alCambiar() {},
      async miPerfil() { await esperar(); return { id: yo.id, email: yo.email, nombre: yo.nombre, rol: yo.rol_rotulos, activo: true, via: "propio", tiene_login_propio: true, fac_rol: yo.rol }; },
    },
    async catalogo() {
      await esperar();
      const personas = rol() === "admin" ? PERSONAS : PERSONAS.filter(p => p.rol);
      return { opciones: copia(opciones), transportes: copia(transportes), ajustes: copia(ajustes), personas: copia(personas) };
    },
    pedidos: {
      async todos() { await esperar(200); return copia(pedidos).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id); },
      async uno(id) { await esperar(); return copia(buscar(id)); },
      async crear(datos) {
        await esperar();
        if (!puedeCargar()) error("No tenés permiso para hacer esto.");
        Object.keys(datos).forEach(k => { if (!CAMPOS_EDITABLES.has(k)) error("No tenés permiso para hacer esto."); });
        const p = limpiar(nuevo(datos));
        pedidos.push(p);
        historial.push({ id: secH++, pedido_id: p.id, accion: "alta", cambios: {}, por: yo.id, en: p.creado_en });
        return copia(p);
      },
      async actualizar(id, cambios) {
        await esperar();
        if (!puedeCargar()) error("No tenés permiso para hacer esto.");
        Object.keys(cambios).forEach(k => { if (!CAMPOS_EDITABLES.has(k)) error("No tenés permiso para hacer esto."); });
        const p = buscar(id), antes = copia(p);
        if ("despacho_fecha" in cambios && cambios.despacho_fecha !== p.despacho_fecha && p.estado !== "despachado") error("La fecha de despacho se carga al marcar el pedido como despachado.");
        const nuevoP = limpiar({ ...p, ...cambios });
        Object.assign(p, nuevoP, { actualizado_en: new Date().toISOString(), actualizado_por: yo.id });
        registrar(antes, p);
        return copia(p);
      },
      async borrar(id) {
        await esperar();
        const p = buscar(id);
        const ok = rol() === "admin" || (rol() === "facturacion" && p.creado_por === yo.id && Date.now() - Date.parse(p.creado_en) < 7200000);
        if (!ok) error("No se pudo borrar: solo el admin, o quien lo cargó dentro de las 2 horas.");
        pedidos.splice(pedidos.indexOf(p), 1);
        historial.push({ id: secH++, pedido_id: id, accion: "borrado", cambios: copia(p), por: yo.id, en: new Date().toISOString() });
      },
      async accion(id, a, d) { await esperar(); return accion(id, a, d); },
      async historial(id) { await esperar(); return copia(historial.filter(h => h.pedido_id === id)).reverse(); },
    },
    clientes: {
      async buscar(q) {
        await esperar(80);
        const n = R.util.norm(q);
        return copia(clientes.filter(c => R.util.norm(c.nombre).includes(n)).slice(0, 8));
      },
    },
    admin: {
      async guardarOpcion(o) {
        await esperar();
        if (rol() !== "admin") error("No tenés permiso para hacer esto.");
        if (opciones.some(x => x.tipo === (o.tipo || (opciones.find(y => y.id === o.id) || {}).tipo) && x.valor === o.valor && x.id !== o.id)) error("Esa opción ya existe en la lista.");
        if (o.id) { const x = opciones.find(y => y.id === o.id); Object.assign(x, { valor: o.valor, orden: o.orden, activo: o.activo }); return copia(x); }
        const x = { id: secO++, tipo: o.tipo, valor: o.valor, orden: o.orden ?? 100, activo: true };
        opciones.push(x);
        return copia(x);
      },
      async guardarAjuste(clave, valor) { await esperar(60); if (rol() !== "admin") error("No tenés permiso para hacer esto."); ajustes = { ...ajustes, [clave]: valor }; return { clave, valor }; },
      async asignarRol(id, r) { await esperar(); if (rol() !== "admin") error("No tenés permiso para hacer esto."); const p = PERSONAS.find(x => x.id === id); if (p) { p.rol = r; p.activo = !!r; } },
    },
  };
})(window.FAC);
