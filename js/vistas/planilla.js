// =====================================================================
//  Planilla: todos los pedidos, con edición en la celda como en Excel.
//    clic = elegir celda · doble clic, Enter, F2 o escribir = editar
//    Enter = guarda y baja · Tab / Mayús+Tab = guarda y pasa de columna
//    Esc = cancela · flechas = moverse · Ctrl+C = copiar la celda · Ctrl+Z = deshacer
//  El estado no se edita acá: un clic en "Estado" o "Qué falta" abre la ficha.
//  Pedido nuevo: una fila arriba; se guarda cuando tiene cliente, y Enter/Tab
//  van pasando de celda en celda para cargarlo de corrido.
// =====================================================================
(function (R) {
  const { $, esc, fmtPesos, fmtFecha, chipEstado, leerMonto, norm, toast, descargarCSV, hoy, ICONOS, pref } = R.util;

  const pesos = n => (n == null ? "" : fmtPesos(n, Math.round(n * 100) % 100 ? 2 : 0));
  const COLS = [
    { k: "numero", t: "N° pedido", tipo: "texto", ancho: 92 },
    { k: "fecha", t: "Fecha", tipo: "fecha", ancho: 104 },
    { k: "cliente", t: "Cliente", tipo: "cliente", ancho: 230 },
    { k: "transporte", t: "Transporte", tipo: "lista", lista: () => R.datos.transportes(), ancho: 150 },
    { k: "facturo", t: "Facturó", tipo: "lista", lista: () => R.datos.opciones("facturo"), ancho: 96 },
    { k: "importe_1", t: "Parte 1", tipo: "monto", ancho: 120 },
    { k: "importe_2", t: "Parte 2", tipo: "monto", ancho: 120 },
    { k: "total", t: "Total", tipo: "calc", ancho: 124 },
    { k: "estado", t: "Estado", tipo: "estado", ancho: 168 },
    { k: "_pend", t: "Qué falta", tipo: "pend", ancho: 210 },
    { k: "armador", t: "Armador", tipo: "lista", lista: () => R.datos.opciones("armador"), ancho: 100 },
    { k: "despacho_fecha", t: "Despacho", tipo: "calc", ancho: 100 },
    { k: "guia", t: "Guía", tipo: "texto", ancho: 140 },
    { k: "observaciones", t: "Observaciones", tipo: "texto", ancho: 240 },
  ];
  const EDITABLES = new Set(["texto", "fecha", "cliente", "lista", "monto"]);
  const LOTE = 300;

  let filas = [];          // lo que se ve (filtrado y ordenado)
  let limite = LOTE;
  let activa = null;       // { id, c }
  let edicion = null;      // { id, c, el, original }
  let borrador = null;     // pedido nuevo todavía sin guardar (id "nuevo")
  let sugerencias = { lista: [], i: -1, caja: null, pedido: 0 };
  let pendienteRepintar = false;
  let cargando = null;     // pedido recién creado en la fila nueva: Enter sigue a la derecha para cargarlo de corrido
  const enCarga = id => id === "nuevo" || (cargando != null && id === cargando);

  const puede = () => R.app.puedeCargar();
  const pedidoDe = id => (id === "nuevo" ? borrador : R.datos.porId(id));
  const idDeFila = tr => (tr.dataset.id === "nuevo" ? "nuevo" : Number(tr.dataset.id));
  const editable = (p, col) => puede() && EDITABLES.has(col.tipo);

  // ---------- Filtros ----------
  function filtrar() {
    const estado = $("pl-estado").value, transp = $("pl-transporte").value;
    const desde = $("pl-desde").value, hasta = $("pl-hasta").value;
    const q = norm($("pl-buscar").value);
    const d = hoy();
    const lista = R.datos.pedidos.filter(p => {
      if (estado === "abiertos" && ["despachado", "baja"].includes(p.estado) && !(p.estado === "despachado" && p.despacho_fecha === d) && !(p.estado === "baja" && !p.nota_credito)) return false;
      if (estado === "hoy" && String(p.creado_en).slice(0, 10) !== d && p.fecha !== d) return false;
      if (!["abiertos", "hoy", "todos"].includes(estado) && p.estado !== estado) return false;
      if (transp && p.transporte !== transp) return false;
      if (desde && p.fecha < desde) return false;
      if (hasta && p.fecha > hasta) return false;
      if (q && !norm([p.cliente, p.numero, p.guia, p.observaciones, p.transporte, p.facturo, p.armador, p.nota_credito].join(" ")).includes(q)) return false;
      return true;
    });
    lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.id - a.id);
    filas = borrador ? [borrador, ...lista] : lista;
  }

  // ---------- Pintar ----------
  function celdaHTML(p, col) {
    const v = p[col.k];
    switch (col.tipo) {
      case "fecha": return v ? fmtFecha(v) : "";
      case "monto": return pesos(v);
      case "calc": return col.k === "total" ? (p.id === "nuevo" ? "" : pesos(v)) : (v ? fmtFecha(v) : "");
      case "estado": return p.id === "nuevo" ? `<span class="hint">sin guardar</span>` : chipEstado(v);
      case "pend": {
        if (p.id === "nuevo") return `<span class="hint">Escribí el cliente para guardarlo</span>`;
        const pe = R.datos.pendiente(p);
        return pe ? `<span class="pend${pe.urgente ? " urgente" : ""}">${esc(pe.texto)}<small>${esc(pe.detalle)}</small></span>` : "";
      }
      default: return esc(v ?? "");
    }
  }
  function claseCelda(p, col) {
    const c = [];
    if (["monto", "calc"].includes(col.tipo) && col.k !== "despacho_fecha") c.push("num");
    if (!editable(p, col)) c.push("solo-ver");
    if (col.tipo === "estado" || col.tipo === "pend") c.push("abre");
    if (col.k === "cliente" && p.revisar) c.push("revisar");
    return c.join(" ");
  }
  function filaHTML(p) {
    const pend = p.id !== "nuevo" && R.datos.pendiente(p);
    return `<tr data-id="${p.id}" class="est-${esc(p.estado)}${pend && pend.urgente ? " urgente" : ""}${p.id === "nuevo" ? " nueva" : ""}">`
      + COLS.map((col, c) => `<td data-c="${c}" class="${claseCelda(p, col)}"${col.k === "cliente" && p.revisar ? ` title="${esc(p.revisar)}"` : ""}>${celdaHTML(p, col)}</td>`).join("")
      + `<td class="acc"><button type="button" class="btn-icono" data-abrir="${p.id}" title="Abrir la ficha" aria-label="Abrir la ficha"${p.id === "nuevo" ? " disabled" : ""}>${ICONOS.abrir}</button></td></tr>`;
  }

  function pintar() {
    if (edicion) { pendienteRepintar = true; return; }
    pendienteRepintar = false;
    filtrar();
    const visibles = filas.slice(0, limite);
    $("pl-cuerpo").innerHTML = visibles.length ? visibles.map(filaHTML).join("")
      : `<tr><td colspan="${COLS.length + 1}" class="vacio" style="padding:22px">No hay pedidos con estos filtros.</td></tr>`;
    pintarResumen();
    $("pl-mas").hidden = filas.length <= limite;
    $("pl-mas").textContent = `Mostrar ${Math.min(LOTE, filas.length - limite)} más (quedan ${filas.length - limite})`;
    marcarActiva(false);
  }

  function pintarResumen() {
    const reales = filas.filter(p => p.id !== "nuevo").map(p => R.datos.porId(p.id) || p);
    const total = reales.reduce((s, p) => s + (p.total || 0), 0);
    $("pl-resumen").textContent = `${reales.length} ${reales.length === 1 ? "pedido" : "pedidos"} · total ${fmtPesos(total)}`;
  }

  function pintarFila(id) {
    const tr = $("pl-cuerpo").querySelector(`tr[data-id="${id}"]`);
    const p = pedidoDe(id);
    if (!tr || !p) return pintar();
    tr.outerHTML = filaHTML(p);
    pintarResumen();
    marcarActiva(false);
  }

  // ---------- Celda activa ----------
  function td(id, c) {
    const tr = $("pl-cuerpo").querySelector(`tr[data-id="${id}"]`);
    return tr ? tr.querySelector(`td[data-c="${c}"]`) : null;
  }
  function marcarActiva(desplazar = true) {
    $("pl-cuerpo").querySelectorAll("td.activa").forEach(x => x.classList.remove("activa"));
    if (!activa) return;
    const el = td(activa.id, activa.c);
    if (!el) { activa = null; return; }
    el.classList.add("activa");
    if (desplazar) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function activar(id, c, desplazar = true) {
    if (borrador && activa && activa.id === "nuevo" && id !== "nuevo" && !borrador.cliente) descartarBorrador();
    if (id !== cargando) cargando = null;
    activa = { id, c: Math.max(0, Math.min(COLS.length - 1, c)) };
    marcarActiva(desplazar);
    $("pl-wrap").focus({ preventScroll: true });
  }
  function mover(df, dc) {
    if (!activa) return;
    const i = filas.findIndex(p => p.id === activa.id);
    const ni = Math.max(0, Math.min(Math.min(filas.length, limite) - 1, i + df));
    if (!filas[ni]) return;
    activar(filas[ni].id, activa.c + dc);
  }

  // ---------- Edición ----------
  const valorTexto = (p, col) => {
    const v = p[col.k];
    if (col.tipo === "monto") return v == null ? "" : Number(v).toLocaleString("es-AR", { maximumFractionDigits: 2 });
    return v ?? "";
  };

  function editar(id, c, inicial) {
    const p = pedidoDe(id), col = COLS[c];
    if (!p) return;
    if (!editable(p, col)) {
      if (p.id !== "nuevo" && ["estado", "pend", "calc"].includes(col.tipo)) R.vistaPedido.abrir(p.id);
      else if (!puede()) toast("Tu usuario solo puede mirar la planilla.");
      return;
    }
    activa = { id, c };
    const celda = td(id, c);
    if (!celda) return;
    let el;
    if (col.tipo === "lista") {
      const ops = col.lista();
      const todas = p[col.k] && !ops.includes(p[col.k]) ? [p[col.k], ...ops] : ops;
      el = document.createElement("select");
      el.innerHTML = `<option value="">—</option>` + todas.map(o => `<option ${o === p[col.k] ? "selected" : ""}>${esc(o)}</option>`).join("");
    } else {
      el = document.createElement("input");
      el.type = col.tipo === "fecha" ? "date" : "text";
      if (col.tipo === "fecha") el.max = hoy();
      if (col.tipo === "monto") el.inputMode = "decimal";
      el.maxLength = col.k === "observaciones" ? 500 : 120;
      el.value = inicial != null && col.tipo !== "fecha" ? inicial : valorTexto(p, col);
      el.autocomplete = "off";
    }
    el.className = "celda-input";
    celda.classList.add("editando");
    celda.replaceChildren(el);
    edicion = { id, c, el, original: p[col.k] };
    el.focus();
    if (el.tagName === "INPUT" && inicial == null && el.type === "text") el.select();
    if (el.tagName === "SELECT" && el.showPicker) { try { el.showPicker(); } catch (e) { /* algunos navegadores no lo permiten */ } }
    el.addEventListener("keydown", teclaEnEdicion);
    el.addEventListener("blur", () => setTimeout(() => { if (edicion && edicion.el === el && !sugerencias.clic) confirmar(null); }, 120));
    if (el.tagName === "SELECT") el.addEventListener("change", () => confirmar(enCarga(id) ? "derecha" : null));
    if (col.tipo === "cliente") {
      el.addEventListener("input", () => buscarClientes(el));
      if (inicial) buscarClientes(el);
    }
  }

  function teclaEnEdicion(e) {
    const s = sugerencias;
    if (s.caja && s.lista.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      s.i = (s.i + (e.key === "ArrowDown" ? 1 : -1) + s.lista.length) % s.lista.length;
      pintarSugerencias();
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); cancelar(); return; }
    if (e.key === "Enter") { e.preventDefault(); confirmar(edicion && enCarga(edicion.id) ? "derecha" : "abajo"); return; }
    if (e.key === "Tab") { e.preventDefault(); confirmar(e.shiftKey ? "izquierda" : "derecha"); return; }
  }

  function cerrarEdicion() {
    cerrarSugerencias();
    const e = edicion;
    edicion = null;
    if (e) {
      const celda = e.el.closest("td");
      if (celda) celda.classList.remove("editando");
    }
    if (pendienteRepintar) pintar();
  }

  function cancelar() {
    const e = edicion;
    cerrarEdicion();
    if (!e) return;
    if (e.id === "nuevo" && !borrador.cliente) { descartarBorrador(); return; }
    pintarFila(e.id);
    activar(e.id, e.c);
  }

  // Lee lo escrito, guarda si cambió y se mueve
  async function confirmar(direccion) {
    if (!edicion) return;
    const { id, c, el } = edicion;
    const p = pedidoDe(id), col = COLS[c];
    const elegido = col.tipo === "cliente" && sugerencias.i >= 0 ? sugerencias.lista[sugerencias.i] : null;
    const crudo = el.value.trim();
    let valor, cambios;
    if (col.tipo === "monto") {
      valor = crudo ? leerMonto(crudo) : null;
      if (crudo && valor == null) { toast("Importe no válido: escribilo como 171.416,45", "error"); el.focus(); return; }
      if (valor != null && valor < 0) { toast("El importe no puede ser negativo.", "error"); el.focus(); return; }
    } else if (col.tipo === "fecha") {
      valor = crudo || p.fecha;
      if (valor > hoy()) { toast("La fecha no puede ser posterior a hoy.", "error"); el.focus(); return; }
    } else valor = crudo;

    if (col.tipo === "cliente") {
      if (elegido) {
        cambios = { cliente: elegido.nombre, cliente_id: elegido.id };
        if (!p.telefono && elegido.tel) cambios.telefono = elegido.tel;
        if (!p.transporte && elegido.transporte) cambios.transporte = elegido.transporte;
      } else {
        if (!valor && id !== "nuevo") { toast("El cliente no puede quedar vacío.", "error"); el.focus(); return; }
        cambios = { cliente: valor };
        if (valor !== p.cliente && p.cliente_id) cambios.cliente_id = null;
      }
    } else cambios = { [col.k]: valor };

    const cambio = Object.keys(cambios).some(k => (cambios[k] ?? null) !== (p[k] ?? null));
    cerrarEdicion();

    if (id === "nuevo") {
      Object.assign(borrador, cambios);
      if (!borrador.cliente) { descartarBorrador(); return; }
      if (cambio || !borrador._guardando) await guardarBorrador();
      seguir(direccion, true);
      return;
    }
    if (cambio) {
      const antes = { ...p };
      Object.assign(p, cambios);
      if ("importe_1" in cambios || "importe_2" in cambios) p.total = (p.importe_1 || 0) + (p.importe_2 || 0);
      pintarFila(id);
      try {
        await R.datos.actualizar(antes, cambios);
        pintarFila(id);
        R.app.contadores();
      } catch (err) {
        R.datos.poner(antes);
        pintarFila(id);
        toast(err.message, "error");
      }
    } else pintarFila(id);
    seguir(direccion, enCarga(id));
  }

  function seguir(direccion, cargandoFila) {
    if (!activa) return;
    if (!direccion) { marcarActiva(false); return; }
    if (direccion === "abajo") return mover(1, 0);
    const dc = direccion === "izquierda" ? -1 : 1;
    if (!cargandoFila) return activar(activa.id, activa.c + dc);
    // Pedido que se está cargando: pasa a la siguiente celda editable y la abre, para seguir de corrido
    const p = pedidoDe(activa.id);
    let c = activa.c + dc;
    while (p && c >= 0 && c < COLS.length && !editable(p, COLS[c])) c += dc;
    if (!p || c < 0 || c >= COLS.length) { cargando = null; return activar(activa.id, activa.c); }
    activar(activa.id, c);
    editar(activa.id, c);
  }

  // ---------- Pedido nuevo ----------
  function nuevo() {
    if (!puede()) return;
    if (borrador) { activar("nuevo", COLS.findIndex(c => c.k === "cliente")); return editar("nuevo", activa.c); }
    if (["despachado", "baja"].includes($("pl-estado").value)) $("pl-estado").value = "abiertos";
    borrador = {
      id: "nuevo", numero: "", tipo: "normal", fecha: hoy(), cliente: "", cliente_id: null, telefono: "", transporte: "",
      facturo: R.datos.facturoPorDefecto(), armador: "", importe_1: null, importe_2: null, alias_pago: R.datos.aliasPorDefecto(),
      faltantes: "", observaciones: "", estado: "facturado", guia: "", revisar: "",
    };
    limite = Math.max(limite, LOTE);
    pintar();
    $("pl-wrap").scrollTop = 0;
    const c = COLS.findIndex(x => x.k === "cliente");
    activar("nuevo", c);
    editar("nuevo", c);
  }
  function descartarBorrador() {
    borrador = null;
    if (activa && activa.id === "nuevo") activa = null;
    pintar();
  }
  async function guardarBorrador() {
    const b = borrador;
    if (!b || b._guardando) return;
    b._guardando = true;
    const datos = {};
    ["numero", "tipo", "fecha", "cliente", "cliente_id", "telefono", "transporte", "facturo", "armador", "importe_1", "importe_2", "alias_pago", "faltantes", "observaciones"]
      .forEach(k => { datos[k] = b[k]; });
    try {
      const p = await R.datos.crear(datos);
      // El resto de la fila se sigue cargando sobre el pedido guardado
      if (borrador === b) borrador = null;
      cargando = p.id;
      if (activa && activa.id === "nuevo") activa.id = p.id;
      if (edicion && edicion.id === "nuevo") edicion.id = p.id;
      pintar();
    } catch (err) {
      b._guardando = false;
      toast(err.message, "error");
    }
  }

  // ---------- Sugerencias de clientes (de rótulos) ----------
  let timerBusqueda;
  function buscarClientes(el) {
    clearTimeout(timerBusqueda);
    const q = el.value.trim();
    if (q.length < 2) return cerrarSugerencias();
    timerBusqueda = setTimeout(async () => {
      const pedido = ++sugerencias.pedido;
      let lista = [];
      try { lista = await R.api.clientes.buscar(q); } catch (e) { return; }
      if (pedido !== sugerencias.pedido || !edicion || edicion.el !== el) return;
      sugerencias.lista = lista;
      sugerencias.i = -1;
      if (!lista.length) return cerrarSugerencias(true);
      pintarSugerencias();
    }, 200);
  }
  function pintarSugerencias() {
    if (!edicion) return;
    let caja = sugerencias.caja;
    if (!caja) {
      caja = sugerencias.caja = document.createElement("ul");
      caja.className = "sugerencias";
      caja.setAttribute("role", "listbox");
      caja.addEventListener("mousedown", e => {
        const li = e.target.closest("li[data-i]");
        if (!li) return;
        e.preventDefault();
        sugerencias.clic = true;
        sugerencias.i = Number(li.dataset.i);
        confirmar(edicion && enCarga(edicion.id) ? "derecha" : null).finally(() => { sugerencias.clic = false; });
      });
      document.body.appendChild(caja);
    }
    const r = edicion.el.getBoundingClientRect();
    caja.style.left = `${Math.round(r.left)}px`;
    caja.style.top = `${Math.round(r.bottom + 4)}px`;
    caja.style.minWidth = `${Math.max(280, Math.round(r.width))}px`;
    caja.innerHTML = sugerencias.lista.map((c, i) => `<li data-i="${i}" role="option" aria-selected="${i === sugerencias.i}">
      <strong>${esc(c.nombre)}</strong><small>${esc([c.ciudad, c.transporte, c.tel].filter(Boolean).join(" · "))}</small></li>`).join("")
      + `<li class="sug-pie">Enter con uno marcado lo elige · si no, queda el nombre escrito</li>`;
  }
  function cerrarSugerencias(mantenerLista) {
    if (sugerencias.caja) { sugerencias.caja.remove(); sugerencias.caja = null; }
    if (!mantenerLista) { sugerencias.lista = []; }
    sugerencias.i = -1;
  }

  // ---------- Teclado y mouse en la grilla ----------
  function teclaGrilla(e) {
    if (edicion || !activa) return;
    if (e.target !== $("pl-wrap")) return;
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); mover(1, 0); }
    else if (k === "ArrowUp") { e.preventDefault(); mover(-1, 0); }
    else if (k === "ArrowLeft") { e.preventDefault(); mover(0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); mover(0, 1); }
    else if (k === "Tab") { e.preventDefault(); mover(0, e.shiftKey ? -1 : 1); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); editar(activa.id, activa.c); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "c") {
      e.preventDefault();
      const el = td(activa.id, activa.c);
      if (el) navigator.clipboard.writeText(el.innerText.trim()).then(() => toast("Celda copiada."), () => {});
    } else if ((k === "Delete" || k === "Backspace") && puede()) {
      const p = pedidoDe(activa.id), col = COLS[activa.c];
      if (!editable(p, col) || col.tipo === "cliente" || col.tipo === "fecha") return;
      e.preventDefault();
      editar(activa.id, activa.c, "");
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const p = pedidoDe(activa.id), col = COLS[activa.c];
      if (editable(p, col) && col.tipo !== "lista" && col.tipo !== "fecha") { e.preventDefault(); editar(activa.id, activa.c, k); }
      else if (editable(p, col)) { e.preventDefault(); editar(activa.id, activa.c); }
    }
  }

  function exportar() {
    filtrar();
    const enc = ["N° pedido", "Fecha", "Cliente", "Teléfono", "Transporte", "Facturó", "Parte 1", "Parte 2", "Total", "Estado", "Qué falta",
      "Armador", "T1", "T2", "Pago confirmado", "Despacho", "Guía", "Nota de crédito", "Observaciones"];
    const num = n => (n == null ? "" : String(n).replace(".", ","));
    const fh = t => (t ? R.util.fechaHora(t) : "");
    const datos = filas.filter(p => p.id !== "nuevo").map(p => {
      const pe = R.datos.pendiente(p);
      return [p.numero, fmtFecha(p.fecha), p.cliente, p.telefono, p.transporte, p.facturo, num(p.importe_1), num(p.importe_2), num(p.total),
        R.util.ESTADOS[p.estado], pe ? pe.texto : "", p.armador, fh(p.t1_en), fh(p.t2_en), fh(p.pago_confirmado_en),
        p.despacho_fecha ? fmtFecha(p.despacho_fecha) : "", p.guia, p.nota_credito, p.observaciones];
    });
    descargarCSV(`facturacion-${hoy()}.csv`, [enc, ...datos]);
  }

  function iniciar() {
    $("pl-cabecera").innerHTML = COLS.map(c => `<th style="min-width:${c.ancho}px"${["monto", "calc"].includes(c.tipo) && c.k !== "despacho_fecha" ? ' class="num"' : ""}>${esc(c.t)}</th>`).join("") + `<th class="acc"></th>`;
    $("pl-exportar").innerHTML = ICONOS.descarga + "Exportar a Excel";
    $("pl-nuevo").innerHTML = ICONOS.mas + "Nuevo pedido";
    $("pl-wrap").tabIndex = 0;
    $("pl-estado").value = pref.leer("pl-estado", "abiertos");
    const alFiltrar = () => { limite = LOTE; pref.guardar("pl-estado", $("pl-estado").value); pintar(); };
    ["pl-estado", "pl-transporte", "pl-desde", "pl-hasta"].forEach(id => $(id).addEventListener("change", alFiltrar));
    let t;
    $("pl-buscar").addEventListener("input", () => { clearTimeout(t); t = setTimeout(alFiltrar, 200); });
    $("pl-mas").addEventListener("click", () => { limite += LOTE; pintar(); });
    $("pl-exportar").addEventListener("click", exportar);
    $("pl-nuevo").addEventListener("click", nuevo);
    $("pl-wrap").addEventListener("keydown", teclaGrilla);
    $("pl-cuerpo").addEventListener("click", e => {
      const ab = e.target.closest("[data-abrir]");
      if (ab) return R.vistaPedido.abrir(Number(ab.dataset.abrir));
      const celda = e.target.closest("td[data-c]");
      if (!celda || celda.classList.contains("editando")) return;
      const id = idDeFila(celda.parentElement), c = Number(celda.dataset.c);
      const col = COLS[c];
      if (id !== "nuevo" && (col.tipo === "estado" || col.tipo === "pend")) { activar(id, c, false); return R.vistaPedido.abrir(id); }
      activar(id, c, false);
    });
    $("pl-cuerpo").addEventListener("dblclick", e => {
      const celda = e.target.closest("td[data-c]");
      if (!celda || celda.classList.contains("editando")) return;
      editar(idDeFila(celda.parentElement), Number(celda.dataset.c));
    });
    window.addEventListener("resize", () => { if (sugerencias.caja) pintarSugerencias(); });
    $("pl-wrap").addEventListener("scroll", () => { if (sugerencias.caja) pintarSugerencias(); });
  }

  function mostrar() {
    const sel = $("pl-transporte"), actual = sel.value;
    const usados = [...new Set([...R.datos.transportes(), ...R.datos.pedidos.map(p => p.transporte).filter(Boolean)])].sort();
    sel.innerHTML = `<option value="">Todos</option>` + usados.map(t => `<option ${t === actual ? "selected" : ""}>${esc(t)}</option>`).join("");
    pintar();
  }

  R.vistaPlanilla = { iniciar, mostrar, nuevo, editando: () => !!edicion };
})(window.FAC);
