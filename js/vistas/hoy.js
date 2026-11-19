// =====================================================================
//  Hoy: lo que hay que hacer, agrupado por tarea (reemplaza la hoja
//  "Resumen del día", el aviso de 48 hs y el resumen diario del generador).
// =====================================================================
(function (R) {
  const { $, esc, fmtPesos, ICONOS, toast, hoy } = R.util;
  const M = window.FacMensajes, P = window.FacPlazos;
  const pesos = n => (n == null ? "—" : fmtPesos(n, Math.round(n * 100) % 100 ? 2 : 0));

  // Bandejas: clave de "qué falta" -> título, explicación y quién actúa
  const BANDEJAS = [
    { k: "t2", titulo: "Mandar T2", icono: ICONOS.alerta, ayuda: "Pasaron las horas hábiles desde el T1 sin pago. Mandá el recordatorio.", urgente: true },
    { k: "baja", titulo: "Dar de baja (T3)", icono: ICONOS.basura, ayuda: "No respondieron al T2. Se da de baja, se emite la nota de crédito y se avisa con el T3.", urgente: true },
    { k: "t1", titulo: "Mandar T1", icono: ICONOS.mensaje, ayuda: "Recién facturados: mandá la factura, el rótulo y los datos de pago el mismo día." },
    { k: "confirmar", titulo: "Pagos a confirmar", icono: ICONOS.billete, ayuda: "El cliente mandó el comprobante. Administración o Facturación confirman que el dinero entró." },
    { k: "despachar", titulo: "Listos para despachar", icono: ICONOS.camion, ayuda: "Pago confirmado. Salen en la próxima ventana." },
    { k: "nc", titulo: "Falta el n° de nota de crédito", icono: ICONOS.alerta, ayuda: "Pedidos dados de baja sin la nota de crédito cargada." },
  ];

  function agrupar(ahora = new Date()) {
    const g = { t1: [], t2: [], baja: [], confirmar: [], despachar: [], nc: [], esperando: [], despachadosHoy: [] };
    const d = hoy();
    for (const p of R.datos.pedidos) {
      if (p.estado === "despachado") { if (p.despacho_fecha === d) g.despachadosHoy.push(p); continue; }
      const pend = R.datos.pendiente(p, ahora);
      if (!pend) continue;
      const item = { ...p, _pend: pend, _detalle: pend.detalle };
      if (pend.clave === "esperar" || pend.clave === "esperar_t2") g.esperando.push(item);
      else if (g[pend.clave]) g[pend.clave].push(item);
    }
    // Lo más viejo primero
    Object.values(g).forEach(l => l.sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en))));
    return g;
  }

  function botones(p, clave) {
    const carga = R.app.puedeFacturar(), cobra = R.app.puedeCobrar();
    const b = (accion, texto, icono, clase = "") => `<button type="button" class="btn-sec ${clase}" data-hacer="${accion}" data-id="${p.id}">${icono || ""}${esc(texto)}</button>`;
    const out = [];
    if (clave === "t1" && carga) out.push(b("msg-t1", "Mensaje T1", ICONOS.mensaje, "primario"));
    if (clave === "t2" && carga) out.push(b("msg-t2", "Mensaje T2", ICONOS.mensaje, "primario"));
    if (clave === "baja" && carga) out.push(b("baja", "Dar de baja", ICONOS.basura, "peligro-sec"));
    if (["t1", "t2", "baja", "esperando"].includes(clave) && carga) out.push(b("informar_pago", "Mandó el comprobante", ICONOS.billete));
    if (clave === "confirmar" && cobra) { out.push(b("confirmar_pago", "Confirmar pago", ICONOS.check, "primario")); out.push(b("rechazar_pago", "No entró", ICONOS.x)); }
    if (clave === "despachar" && carga) out.push(b("despachar", "Despachado", ICONOS.camion, "primario"));
    if (clave === "nc" && carga) out.push(b("nc", "Cargar NC", ICONOS.mas));
    return out.join("");
  }

  function fila(p, clave) {
    const urgente = p._pend && p._pend.urgente;
    return `<li class="tarea${urgente ? " urgente" : ""}">
      <div class="tarea-info">
        <button type="button" class="tarea-cliente" data-abrir="${p.id}">${esc(p.cliente)}</button>
        <span class="tarea-meta">${p.numero ? "N° " + esc(p.numero) + " · " : ""}${esc(p.transporte || "sin transporte")}${p.facturo ? " · facturó " + esc(p.facturo) : ""}</span>
        ${p._detalle ? `<span class="tarea-detalle">${urgente ? ICONOS.alerta : ICONOS.reloj}${esc(p._detalle)}</span>` : ""}
      </div>
      <strong class="tarea-total">${pesos(p.total)}</strong>
      <div class="tarea-acciones">${botones(p, clave)}</div>
    </li>`;
  }

  function mostrar() {
    const ahora = new Date();
    const g = agrupar(ahora);
    const v = P.proximaVentana(R.datos.ajustes(), ahora);
    const fecha = ahora.toLocaleDateString("es-AR", { timeZone: R.util.ZONA, weekday: "long", day: "numeric", month: "long" });
    $("hoy-sub").textContent = `${R.datos.nombreSucursal()} · ${fecha} · Próxima ventana de despacho: ${v ? `${v.hora} (${v.dia === "hoy" || v.dia === "mañana" ? v.dia : R.util.fmtFecha(v.dia)})` : "sin ventanas cargadas"}`;

    // Indicadores (tocar uno lleva a su bandeja)
    const kpi = (k, etiqueta, n, detalle, destacado) =>
      `<button type="button" class="kpi kpi-boton${destacado && n ? " destacado alerta" : ""}" data-ir="${k}"><div class="etiqueta">${etiqueta}</div><div class="valor">${n}</div><div class="detalle">${detalle}</div></button>`;
    const totalDesp = g.despachar.reduce((s, p) => s + (p.total || 0), 0);
    $("hoy-kpis").innerHTML = [
      kpi("t2", "Mandar T2", g.t2.length, "más de 48 h hábiles sin pago", true),
      kpi("baja", "Dar de baja", g.baja.length, "sin respuesta al T2", true),
      kpi("t1", "Mandar T1", g.t1.length, "facturados sin contactar", false),
      kpi("confirmar", "Pagos a confirmar", g.confirmar.length, "comprobantes por revisar", R.app.rol() === "administracion"),
      kpi("despachar", "Para despachar", g.despachar.length, g.despachar.length ? pesos(totalDesp) : "nada pendiente", false),
    ].join("");

    // Administración ve primero lo suyo
    const orden = R.app.rol() === "administracion" ? ["confirmar", ...BANDEJAS.map(b => b.k).filter(k => k !== "confirmar")] : BANDEJAS.map(b => b.k);
    const html = orden.map(k => {
      const b = BANDEJAS.find(x => x.k === k), lista = g[k];
      if (!lista.length) return "";
      return `<section class="caja bandeja${b.urgente ? " bandeja-urgente" : ""}" id="bj-${k}">
        <h2>${b.icono}${b.titulo}<span class="cuenta">${lista.length}</span></h2>
        <p class="hint">${b.ayuda}</p>
        <ul class="tareas">${lista.map(p => fila(p, k)).join("")}</ul>
      </section>`;
    }).join("");
    const nada = !BANDEJAS.some(b => g[b.k].length);
    const enPlazo = g.esperando.length ? `<details class="caja bandeja" id="bj-esperando"><summary><h2>${ICONOS.reloj}Esperando pago, en plazo<span class="cuenta">${g.esperando.length}</span></h2></summary>
        <p class="hint">Ya tienen el T1 (o el T2) y todavía no se cumplió el plazo. Aparecen arriba cuando venza.</p>
        <ul class="tareas">${g.esperando.map(p => fila(p, "esperando")).join("")}</ul></details>` : "";
    const despachados = g.despachadosHoy.length ? `<details class="caja bandeja"><summary><h2>${ICONOS.check}Despachados hoy<span class="cuenta">${g.despachadosHoy.length}</span></h2></summary>
        <ul class="tareas">${g.despachadosHoy.map(p => fila({ ...p, _detalle: p.guia ? "guía " + p.guia : (p.remito_firmado ? "remito firmado" : "sin guía cargada") }, "hecho")).join("")}</ul></details>` : "";
    $("hoy-bandejas").innerHTML = (nada ? `<div class="caja vacio-grande">${ICONOS.check}<p><strong>No hay nada pendiente.</strong><br>Cuando se cargue un pedido o venza un plazo, aparece acá.</p></div>` : html) + enPlazo + despachados;
  }

  function textoResumen() {
    const ahora = new Date();
    const g = agrupar(ahora);
    const v = P.proximaVentana(R.datos.ajustes(), ahora);
    const fecha = ahora.toLocaleDateString("es-AR", { timeZone: R.util.ZONA, weekday: "long", day: "numeric", month: "numeric" });
    return M.resumenDia(g, { fecha, ventana: v ? v.hora : "", sucursal: R.datos.nombreSucursal() });
  }

  // Cantidad para el menú: lo urgente del rol
  function contador() {
    const g = agrupar();
    const rol = R.app.rol();
    if (rol === "administracion") return g.confirmar.length;
    if (rol === "consulta") return 0;
    return g.t2.length + g.baja.length + g.t1.length + g.confirmar.length;
  }

  async function hacer(accion, id) {
    const p = R.datos.porId(Number(id));
    if (!p) return;
    try {
      if (accion.startsWith("msg-")) return R.vistaPedido.abrir(p.id, { pestana: "mensajes", plantilla: accion.slice(4) });
      if (accion === "despachar") return void (await R.datos.despachar(p));
      if (accion === "baja") {
        const r = await R.datos.darDeBaja(p);
        if (r) R.vistaPedido.abrir(p.id, { pestana: "mensajes", plantilla: "t3" });
        return;
      }
      if (accion === "nc") return void (await R.datos.cargarNC(p));
      await R.datos.accion(p, accion);
    } catch (e) { toast(e.message, "error"); }
  }

  function iniciar() {
    $("hoy-copiar-resumen").innerHTML = ICONOS.copiar + "Copiar resumen del día";
    $("hoy-nuevo").innerHTML = ICONOS.mas + "Nuevo pedido";
    $("hoy-copiar-resumen").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(textoResumen()); toast("Resumen copiado: pegalo en WhatsApp."); }
      catch (e) { toast("No se pudo copiar: " + e.message, "error"); }
    });
    $("hoy-nuevo").addEventListener("click", () => { location.hash = "#planilla"; setTimeout(() => R.vistaPlanilla.nuevo(), 0); });
    $("vista-hoy").addEventListener("click", e => {
      const h = e.target.closest("[data-hacer]");
      if (h) return hacer(h.dataset.hacer, h.dataset.id);
      const a = e.target.closest("[data-abrir]");
      if (a) return R.vistaPedido.abrir(Number(a.dataset.abrir));
      const ir = e.target.closest("[data-ir]");
      if (ir) { const b = $("bj-" + ir.dataset.ir); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); else toast("No hay pedidos en esa bandeja."); }
    });
  }

  R.vistaHoy = { iniciar, mostrar, contador, agrupar, textoResumen };
})(window.FAC);
