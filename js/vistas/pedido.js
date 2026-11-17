// =====================================================================
//  Ficha de un pedido (diálogo): qué falta, acciones, datos, mensajes
//  T1/T2/T3 armados con plantillas e historial de cambios.
// =====================================================================
(function (R) {
  const { $, esc, fmtPesos, fmtFecha, fechaHora, chipEstado, ICONOS, toast, pref, leerMonto, hoy } = R.util;
  const M = window.FacMensajes;

  let actualId = null;
  let pestana = "datos";
  let msg = null;   // { plantilla, tono, nombre, aclaraciones, texto, editado, marcar }

  const pesos = n => (n == null ? "—" : fmtPesos(n, Math.round(n * 100) % 100 ? 2 : 0));
  const actual = () => R.datos.porId(actualId);

  function plantillaSugerida(p) {
    if (p.estado === "baja") return "t3";
    const pend = R.datos.pendiente(p);
    if (pend && pend.clave === "baja") return "t3";
    if (p.estado === "esperando_pago") return "t2";
    return "t1";
  }

  function abrir(id, { pestana: pst, plantilla } = {}) {
    const p = R.datos.porId(id);
    if (!p) return;
    actualId = id;
    pestana = pst || "datos";
    msg = { plantilla: plantilla || plantillaSugerida(p), tono: pref.leer("tono", "cercano"), nombre: M.nombreSaludo(p.cliente), aclaraciones: "", texto: "", editado: false, marcar: true };
    pintar();
    if (!$("dlg-pedido").open) $("dlg-pedido").showModal();
  }

  // ---------- Botones de acción según el estado y el rol ----------
  function botones(p) {
    const carga = R.app.puedeCargar(), cobra = R.app.puedeCobrar(), b = [];
    const boton = (accion, texto, icono, clase = "") => `<button type="button" class="btn-sec ${clase}" data-accion="${accion}">${icono || ""}${esc(texto)}</button>`;
    const abierto = ["facturado", "esperando_pago", "pago_informado"].includes(p.estado);
    if (carga && p.estado === "facturado") b.push(boton("msg-t1", "Mensaje T1", ICONOS.mensaje, "primario"));
    if (carga && p.estado === "esperando_pago") b.push(boton("msg-t2", "Mensaje T2", ICONOS.mensaje, R.datos.pendiente(p)?.clave === "t2" ? "primario" : ""));
    if (carga && ["facturado", "esperando_pago"].includes(p.estado)) b.push(boton("informar_pago", "Mandó el comprobante", ICONOS.billete));
    if (cobra && abierto) b.push(boton("confirmar_pago", "Confirmar pago", ICONOS.check, p.estado === "pago_informado" ? "primario" : ""));
    if (cobra && p.estado === "pago_informado") b.push(boton("rechazar_pago", "El pago no entró", ICONOS.x));
    if (carga && p.estado === "listo") b.push(boton("despachar", "Despachado", ICONOS.camion, "primario"));
    if (R.app.esAdmin() && abierto) b.push(boton("despachar", "Despachar sin pago", ICONOS.camion));
    if (carga && abierto) b.push(boton("baja", "Dar de baja", ICONOS.basura, R.datos.pendiente(p)?.clave === "baja" ? "peligro-sec" : ""));
    if (carga && p.estado === "baja") b.push(boton("msg-t3", "Mensaje T3", ICONOS.mensaje));
    if (carga && p.estado === "baja" && !p.nota_credito) b.push(boton("nc", "Cargar nota de crédito", ICONOS.mas));
    const puedeVolver = p.estado !== "facturado" && (p.estado === "listo" ? cobra : carga);
    if (puedeVolver) b.push(boton("volver", "Volver un paso", ICONOS.deshacer, "suave"));
    return b.join("");
  }

  function pintar() {
    const p = actual();
    if (!p) { if ($("dlg-pedido").open) $("dlg-pedido").close(); return; }
    $("pd-titulo").innerHTML = `${esc(p.cliente)} ${chipEstado(p.estado)}`;
    const pend = R.datos.pendiente(p);
    const partes = p.importe_2 ? ` <small>(${pesos(p.importe_1)} + ${pesos(p.importe_2)})</small>` : "";
    $("pd-cuerpo").innerHTML = `
      <div class="pd-resumen">
        <p class="pd-datos-clave">
          <span>${p.numero ? "N° " + esc(p.numero) : "Sin n° de pedido"}${p.tipo !== "normal" ? " · " + esc(p.tipo) : ""}</span>
          <span>${fmtFecha(p.fecha)}</span><span>${esc(p.transporte || "Sin transporte")}</span>
          <strong>${pesos(p.total)}${partes}</strong>
        </p>
        ${p.revisar ? `<p class="pd-revisar">${ICONOS.alerta}<span>${esc(p.revisar)}</span></p>` : ""}
        ${pend ? `<p class="pd-pendiente${pend.urgente ? " urgente" : ""}">${pend.urgente ? ICONOS.alerta : ICONOS.reloj}<span><strong>${esc(pend.texto)}</strong> · ${esc(pend.detalle)}</span></p>` : ""}
        <div class="pd-acciones">${botones(p)}</div>
      </div>
      <div class="pestanas" role="tablist">
        ${[["datos", "Datos"], ["mensajes", "Mensajes"], ["historial", "Historial"]].map(([k, t]) =>
          `<button type="button" role="tab" data-pestana="${k}" aria-selected="${k === pestana}">${t}</button>`).join("")}
      </div>
      <div id="pd-panel"></div>`;
    pintarPanel();
  }

  function pintarPanel() {
    const p = actual();
    if (!p) return;
    if (pestana === "mensajes") return pintarMensajes(p);
    if (pestana === "historial") return pintarHistorial(p);
    return pintarDatos(p);
  }

  // ---------- Datos ----------
  function opcionesSelect(lista, valor, vacio = "—") {
    const todas = valor && !lista.includes(valor) ? [valor, ...lista] : lista;
    return `<option value="">${vacio}</option>` + todas.map(o => `<option ${o === valor ? "selected" : ""}>${esc(o)}</option>`).join("");
  }
  const montoInput = v => (v == null ? "" : Number(v).toLocaleString("es-AR", { maximumFractionDigits: 2 }));

  function pintarDatos(p) {
    const ed = R.app.puedeCargar();
    const dis = ed ? "" : "disabled";
    const linea = (texto, en, por) => (en ? `<li><span>${texto}</span><span>${fechaHora(en)}${por ? " · " + esc(R.datos.nombrePersona(por)) : ""}</span></li>` : "");
    const puedeBorrar = R.app.esAdmin() || (ed && p.creado_por === R.estado.perfil.id && Date.now() - Date.parse(p.creado_en) < 2 * 3600000);
    $("pd-panel").innerHTML = `
      <form id="pd-form" class="form-grid pd-form" autocomplete="off">
        <div><label for="pd-numero">N° de pedido</label><input id="pd-numero" maxlength="40" value="${esc(p.numero)}" ${dis}></div>
        <div><label for="pd-fecha">Fecha</label><input type="date" id="pd-fecha" value="${esc(p.fecha)}" max="${hoy()}" ${dis}></div>
        <div class="full"><label for="pd-cliente">Cliente</label><input id="pd-cliente" maxlength="120" value="${esc(p.cliente)}" ${dis} required>
          <p class="hint">${p.cliente_id ? "Vinculado a un cliente de rótulos." : "Escrito a mano (no está vinculado a un cliente de rótulos)."}</p></div>
        <div><label for="pd-telefono">Teléfono (WhatsApp)</label><input id="pd-telefono" maxlength="40" value="${esc(p.telefono)}" ${dis}></div>
        <div><label for="pd-tipo">Tipo</label><select id="pd-tipo" ${dis}>${["normal", "preventa", "muestras"].map(t => `<option value="${t}" ${t === p.tipo ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></div>
        <div><label for="pd-transporte">Transporte</label><select id="pd-transporte" ${dis}>${opcionesSelect(R.datos.transportes(), p.transporte)}</select></div>
        <div><label for="pd-facturo">Facturó</label><select id="pd-facturo" ${dis}>${opcionesSelect(R.datos.opciones("facturo"), p.facturo)}</select></div>
        <div><label for="pd-importe1">Parte 1</label><input id="pd-importe1" inputmode="decimal" value="${montoInput(p.importe_1)}" ${dis}></div>
        <div><label for="pd-importe2">Parte 2 (opcional)</label><input id="pd-importe2" inputmode="decimal" value="${montoInput(p.importe_2)}" ${dis}></div>
        <div><label for="pd-alias">Alias de pago</label><select id="pd-alias" ${dis}>${opcionesSelect(R.datos.opciones("alias"), p.alias_pago)}</select></div>
        <div><label for="pd-armador">Armador</label><select id="pd-armador" ${dis}>${opcionesSelect(R.datos.opciones("armador"), p.armador)}</select></div>
        <div class="full"><label for="pd-faltantes">Faltantes</label><input id="pd-faltantes" maxlength="300" value="${esc(p.faltantes)}" placeholder="Ej. 3 unidades billetera ref. 205" ${dis}></div>
        <div><label for="pd-guia">N° de guía</label><input id="pd-guia" maxlength="60" value="${esc(p.guia)}" ${dis}></div>
        <div><label for="pd-nc">Nota de crédito</label><input id="pd-nc" maxlength="60" value="${esc(p.nota_credito)}" ${dis}></div>
        ${p.estado === "despachado" ? `<div><label for="pd-despacho">Fecha de despacho</label><input type="date" id="pd-despacho" value="${esc(p.despacho_fecha || "")}" min="${esc(p.fecha)}" max="${hoy()}" ${dis}></div>` : ""}
        <div class="full" style="margin-top:12px"><label class="interruptor"><input type="checkbox" id="pd-remito" ${p.remito_firmado ? "checked" : ""} ${dis}><span class="interruptor-pista"></span>Remito firmado por el comisionista</label></div>
        <div class="full"><label for="pd-obs">Observaciones</label><textarea id="pd-obs" rows="2" maxlength="500" ${dis}>${esc(p.observaciones)}</textarea></div>
        ${p.revisar ? `<div class="full"><label for="pd-revisar">Aviso para revisar</label><input id="pd-revisar" maxlength="300" value="${esc(p.revisar)}" ${dis}><p class="hint">Borralo cuando el dato esté corregido.</p></div>` : ""}
        <div class="mensaje-error full" id="pd-error" role="alert"></div>
        ${ed ? `<div class="dlg-pie full">${puedeBorrar ? `<button type="button" class="btn-sec peligro-sec" id="pd-borrar">${ICONOS.basura}Borrar pedido</button>` : ""}<span style="flex:1"></span><button type="submit" class="btn-sec primario">Guardar cambios</button></div>` : ""}
      </form>
      <ul class="pd-fechas">
        ${linea("Cargado", p.creado_en, p.creado_por)}
        ${linea("T1 enviado", p.t1_en)}${linea("T2 enviado", p.t2_en)}
        ${linea("Pago informado", p.pago_informado_en)}${linea("Pago confirmado", p.pago_confirmado_en, p.pago_confirmado_por)}
        ${linea("Despachado", p.despachado_en, p.despachado_por)}${linea("Dado de baja", p.baja_en, p.baja_por)}
        ${p.motivo_baja ? `<li><span>Motivo de la baja</span><span>${esc(p.motivo_baja)}</span></li>` : ""}
      </ul>`;
    if (!ed) return;
    $("pd-form").addEventListener("submit", async e => {
      e.preventDefault();
      $("pd-error").textContent = "";
      const i1 = $("pd-importe1").value.trim(), i2 = $("pd-importe2").value.trim();
      const nuevo = {
        numero: $("pd-numero").value.trim(), fecha: $("pd-fecha").value, cliente: $("pd-cliente").value.trim(),
        telefono: $("pd-telefono").value.trim(), tipo: $("pd-tipo").value, transporte: $("pd-transporte").value,
        facturo: $("pd-facturo").value, importe_1: i1 ? leerMonto(i1) : null, importe_2: i2 ? leerMonto(i2) : null,
        alias_pago: $("pd-alias").value, armador: $("pd-armador").value, faltantes: $("pd-faltantes").value.trim(),
        guia: $("pd-guia").value.trim(), nota_credito: $("pd-nc").value.trim(), remito_firmado: $("pd-remito").checked,
        observaciones: $("pd-obs").value.trim(),
      };
      if ($("pd-despacho")) nuevo.despacho_fecha = $("pd-despacho").value || p.despacho_fecha;
      if ($("pd-revisar")) nuevo.revisar = $("pd-revisar").value.trim();
      if ((i1 && nuevo.importe_1 == null) || (i2 && nuevo.importe_2 == null)) return ($("pd-error").textContent = "Revisá los importes: tienen que ser números (ej. 171.416,45).");
      if (!nuevo.cliente) return ($("pd-error").textContent = "Falta el cliente.");
      const cambios = {};
      Object.keys(nuevo).forEach(k => { if ((nuevo[k] ?? null) !== (p[k] ?? null)) cambios[k] = nuevo[k]; });
      if (nuevo.cliente !== p.cliente && p.cliente_id) cambios.cliente_id = null;
      if (!Object.keys(cambios).length) return toast("No hay cambios para guardar.");
      try {
        await R.datos.actualizar(p, cambios, { avisar: true });
        R.app.refrescar();
      } catch (err) { $("pd-error").textContent = err.message; }
    });
    const borrar = $("pd-borrar");
    if (borrar) borrar.addEventListener("click", async () => {
      const ok = await R.util.pedir({ titulo: "Borrar pedido", texto: `Se borra el pedido de ${p.cliente} (${pesos(p.total)}). Usalo solo si se cargó por error: para un pedido que no se pagó, usá "Dar de baja".`, boton: "Borrar", peligro: true });
      if (ok == null) return;
      try { await R.datos.borrar(p); $("dlg-pedido").close(); } catch (err) { toast(err.message, "error"); }
    });
  }

  // ---------- Mensajes ----------
  const MARCA = {
    t1: p => (p.estado === "facturado" ? { accion: "t1", texto: "Marcar T1 como enviado" } : null),
    t2: p => (p.estado === "esperando_pago" && !p.t2_en ? { accion: "t2", texto: "Marcar T2 como enviado" } : null),
    t3: p => (["facturado", "esperando_pago", "pago_informado"].includes(p.estado) ? { accion: "baja", texto: "Dar de baja el pedido (pide el n° de nota de crédito)" } : null),
  };

  function generar(p) {
    return M.PLANTILLAS[msg.plantilla](M.datosDe(p, { nombre: msg.nombre || M.nombreSaludo(p.cliente), aclaraciones: msg.aclaraciones }), msg.tono);
  }

  function pintarMensajes(p) {
    const carga = R.app.puedeCargar();
    if (!msg.editado) msg.texto = generar(p);
    const marca = carga && MARCA[msg.plantilla](p);
    const tel = M.telefonoWhatsapp(p.telefono);
    const pill = (grupo, valor, texto, activo) => `<button type="button" class="pastilla" data-${grupo}="${valor}" aria-pressed="${activo}">${esc(texto)}</button>`;
    $("pd-panel").innerHTML = `
      <div class="pd-msg">
        <div class="pd-msg-controles">
          <div><label>Mensaje</label><div class="pastillas">
            ${pill("plantilla", "t1", "T1 · Contacto inicial", msg.plantilla === "t1")}
            ${pill("plantilla", "t2", "T2 · Recordatorio", msg.plantilla === "t2")}
            ${pill("plantilla", "t3", "T3 · Baja", msg.plantilla === "t3")}</div></div>
          <div><label>Tono</label><div class="pastillas">
            ${Object.entries(M.TONOS).map(([k, t]) => pill("tono", k, t, msg.tono === k)).join("")}</div></div>
          <div class="form-grid">
            <div><label for="pd-saludo">Nombre para el saludo</label><input id="pd-saludo" maxlength="80" value="${esc(msg.nombre)}"></div>
            ${msg.plantilla === "t1" ? `<div><label for="pd-aclaraciones">Aclaraciones (opcional)</label><input id="pd-aclaraciones" maxlength="300" value="${esc(msg.aclaraciones)}" placeholder="Ej. fecha límite, condiciones especiales"></div>` : ""}
          </div>
          ${msg.plantilla === "t1" && !p.alias_pago ? `<p class="pd-revisar">${ICONOS.alerta}<span>El pedido no tiene alias de pago: elegilo en Datos.</span></p>` : ""}
          ${msg.plantilla !== "t3" && !p.total ? `<p class="pd-revisar">${ICONOS.alerta}<span>El pedido no tiene importe cargado.</span></p>` : ""}
        </div>
        <label for="pd-texto">Texto (lo podés retocar antes de copiar)</label>
        <textarea id="pd-texto" class="mensaje-texto" rows="11">${esc(msg.texto)}</textarea>
        ${marca ? `<label class="interruptor" style="margin-top:10px"><input type="checkbox" id="pd-marcar" ${msg.marcar ? "checked" : ""}><span class="interruptor-pista"></span>${esc(marca.texto)} al copiar o abrir WhatsApp</label>` : ""}
        <div class="pd-msg-acciones">
          <button type="button" class="btn-sec primario" id="pd-copiar">${ICONOS.copiar}Copiar</button>
          <button type="button" class="btn-sec" id="pd-wa">${ICONOS.whatsapp}Abrir WhatsApp</button>
          ${msg.editado ? `<button type="button" class="btn-sec suave" id="pd-regenerar">${ICONOS.deshacer}Volver al texto armado</button>` : ""}
        </div>
        <p class="hint">${tel ? `WhatsApp se abre con el número ${esc(p.telefono)}.` : "El pedido no tiene un celular válido: WhatsApp se abre para elegir el contacto."} La factura y el rótulo se adjuntan a mano.</p>
      </div>`;
    $("pd-saludo").addEventListener("input", e => { msg.nombre = e.target.value; msg.editado = false; refrescarTexto(p); });
    if ($("pd-aclaraciones")) $("pd-aclaraciones").addEventListener("input", e => { msg.aclaraciones = e.target.value; msg.editado = false; refrescarTexto(p); });
    $("pd-texto").addEventListener("input", e => { msg.texto = e.target.value; if (!msg.editado) { msg.editado = true; } });
    if ($("pd-marcar")) $("pd-marcar").addEventListener("change", e => { msg.marcar = e.target.checked; });
    $("pd-copiar").addEventListener("click", () => enviar(p, "copiar"));
    $("pd-wa").addEventListener("click", () => enviar(p, "whatsapp"));
    if ($("pd-regenerar")) $("pd-regenerar").addEventListener("click", () => { msg.editado = false; pintarMensajes(p); });
  }
  function refrescarTexto(p) { msg.texto = generar(p); $("pd-texto").value = msg.texto; }

  async function enviar(p, como) {
    const marca = R.app.puedeCargar() && msg.marcar && MARCA[msg.plantilla](p);
    let texto = $("pd-texto").value;
    // La baja va primero: el T3 lleva el número de nota de crédito
    if (marca && marca.accion === "baja") {
      const r = await R.datos.darDeBaja(p).catch(e => { toast(e.message, "error"); return null; });
      if (!r) return;
      if (!msg.editado) texto = msg.texto = generar(r);
    }
    if (como === "whatsapp") window.open(M.linkWhatsapp(p.telefono, texto), "_blank", "noopener");
    else {
      try { await navigator.clipboard.writeText(texto); } catch (e) { $("pd-texto").select(); document.execCommand("copy"); }
    }
    if (marca && marca.accion !== "baja") {
      try { await R.datos.accion(p, marca.accion); } catch (e) { return toast(e.message, "error"); }
    } else if (!marca) toast(como === "whatsapp" ? "WhatsApp abierto con el mensaje." : "Mensaje copiado.");
    // (con la baja queda el aviso "Dado de baja" con su botón Deshacer)
    msg.texto = texto;
    pintar();
  }

  // ---------- Historial ----------
  const formatoValor = (k, v) => {
    if (v == null || v === "") return "vacío";
    if (k === "estado") return R.util.ESTADOS[v] || v;
    if (/_en$/.test(k)) return fechaHora(v);
    if (/_por$/.test(k)) return R.datos.nombrePersona(v);
    if (/^importe_/.test(k)) return pesos(Number(v));
    if (k === "fecha" || k === "despacho_fecha") return fmtFecha(v);
    if (typeof v === "boolean") return v ? "sí" : "no";
    return String(v);
  };
  async function pintarHistorial(p) {
    $("pd-panel").innerHTML = `<p class="vacio">Cargando historial…</p>`;
    let filas;
    try { filas = await R.api.pedidos.historial(p.id); }
    catch (e) { $("pd-panel").innerHTML = `<p class="mensaje-error">${esc(e.message)}</p>`; return; }
    if (actualId !== p.id || pestana !== "historial") return;
    const ocultos = new Set(["id", "creado_en", "creado_por", "actualizado_en", "actualizado_por", "total", "cliente_id"]);
    $("pd-panel").innerHTML = filas.length ? `<ul class="historial">${filas.map(h => {
      let que;
      if (h.accion === "alta") que = "Cargó el pedido";
      else if (h.accion === "borrado") que = "Borró el pedido";
      else {
        que = Object.entries(h.cambios || {}).filter(([k]) => !ocultos.has(k)).map(([k, [a, d]]) =>
          k === "estado" ? `<strong>${esc(formatoValor(k, a))} → ${esc(formatoValor(k, d))}</strong>`
            : /_(en|por)$/.test(k) ? `${esc(R.datos.CAMPOS[k] || k)}: ${d == null ? "se quitó" : esc(formatoValor(k, d))}`
              : `${esc(R.datos.CAMPOS[k] || k)}: ${esc(formatoValor(k, a))} → ${esc(formatoValor(k, d))}`).join("<br>") || "Cambio interno";
      }
      return `<li><span class="h-cuando">${fechaHora(h.en)}<small>${esc(R.datos.nombrePersona(h.por) || "sistema")}</small></span><span class="h-que">${que}</span></li>`;
    }).join("")}</ul>` : `<p class="vacio">Sin cambios registrados.</p>`;
  }

  // ---------- Eventos ----------
  async function hacer(accion) {
    const p = actual();
    if (!p) return;
    try {
      if (accion === "msg-t1" || accion === "msg-t2" || accion === "msg-t3") {
        pestana = "mensajes"; msg.plantilla = accion.slice(4); msg.editado = false; msg.marcar = true;
        return pintar();
      }
      if (accion === "despachar") await R.datos.despachar(p);
      else if (accion === "baja") {
        const r = await R.datos.darDeBaja(p);
        if (r) { pestana = "mensajes"; msg.plantilla = "t3"; msg.editado = false; }
      } else if (accion === "nc") await R.datos.cargarNC(p);
      else await R.datos.accion(p, accion);
    } catch (e) { toast(e.message, "error"); }
    pintar();
  }

  function iniciar() {
    $("dlg-pedido").addEventListener("click", e => {
      const a = e.target.closest("[data-accion]");
      if (a) return hacer(a.dataset.accion);
      const t = e.target.closest("[data-pestana]");
      if (t) { pestana = t.dataset.pestana; return pintar(); }
      const pl = e.target.closest("[data-plantilla]");
      if (pl) { msg.plantilla = pl.dataset.plantilla; msg.editado = false; msg.marcar = true; return pintarPanel(); }
      const to = e.target.closest("[data-tono]");
      if (to) { msg.tono = to.dataset.tono; pref.guardar("tono", msg.tono); msg.editado = false; return pintarPanel(); }
    });
    $("dlg-pedido").addEventListener("close", () => { actualId = null; });
  }

  // Si cambian los datos con la ficha abierta (otra pestaña, actualizar), se vuelve a pintar
  function refrescar() {
    if (!actualId || !$("dlg-pedido").open) return;
    const foco = document.activeElement;
    if (foco && $("dlg-pedido").contains(foco) && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return;   // no pisar lo que se está escribiendo
    pintar();
  }

  R.vistaPedido = { iniciar, abrir, refrescar, abierto: () => !!actualId };
})(window.FAC);
