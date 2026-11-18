// =====================================================================
//  Pedidos en memoria + acciones con "Deshacer".
//  Las vistas leen R.datos.pedidos y cambian datos solo por acá, así
//  todas quedan al día y cada cambio se puede deshacer (aviso o Ctrl+Z).
// =====================================================================
(function (R) {
  const { $, esc, toast, hoy } = R.util;
  const P = window.FacPlazos;

  const pila = window.Deshacer.crear((m, t) => toast(m, t));

  const D = {
    pedidos: [],
    cargadoEn: 0,
    deshacer: pila,
    porId: id => D.pedidos.find(p => p.id === id),
    async cargar() {
      D.pedidos = await R.api.pedidos.todos(R.estado.sucursal);
      D.cargadoEn = Date.now();
    },
    poner(p) {
      const i = D.pedidos.findIndex(x => x.id === p.id);
      if (i >= 0) D.pedidos[i] = p; else D.pedidos.unshift(p);
      return p;
    },
    quitar(id) { D.pedidos = D.pedidos.filter(p => p.id !== id); },

    // ---------- Catálogo ----------
    // Plazos y feriados comunes + las ventanas de despacho de la sucursal elegida
    ajustes() {
      const a = (R.estado.catalogo && R.estado.catalogo.ajustes) || {};
      const s = D.sucursal();
      return { ...P.AJUSTES_DEFECTO, ...a, ...(s && Array.isArray(s.ventanas) ? { ventanas: s.ventanas } : {}) };
    },
    // Listas de la sucursal elegida
    opciones(tipo, { conInactivas = false } = {}) {
      return ((R.estado.catalogo && R.estado.catalogo.opciones) || [])
        .filter(o => o.tipo === tipo && o.sucursal === R.estado.sucursal && (conInactivas || o.activo)).map(o => o.valor);
    },
    // Sucursal elegida ({ clave, nombre, ventanas }) y las que puede usar quien está logueado
    sucursal() { return ((R.estado.catalogo && R.estado.catalogo.sucursales) || []).find(s => s.clave === R.estado.sucursal) || null; },
    misSucursales() {
      const mis = (R.estado.catalogo && R.estado.catalogo.misSucursales) || [];
      return ((R.estado.catalogo && R.estado.catalogo.sucursales) || []).filter(s => s.activa && mis.includes(s.clave));
    },
    nombreSucursal(clave = R.estado.sucursal) {
      const s = ((R.estado.catalogo && R.estado.catalogo.sucursales) || []).find(x => x.clave === clave);
      return s ? s.nombre : clave || "";
    },
    transportes() {
      return ((R.estado.catalogo && R.estado.catalogo.transportes) || []).filter(t => t.activo).map(t => t.nombre);
    },
    nombrePersona(id) {
      if (!id) return "";
      const p = ((R.estado.catalogo && R.estado.catalogo.personas) || []).find(x => x.id === id);
      return p ? p.nombre : "otra persona";
    },
    pendiente(p, ahora = new Date()) { return P.pendiente(p, D.ajustes(), ahora); },
    // Quién facturó por defecto: la persona logueada si está en la lista ("Greisy"), si no, vacío
    facturoPorDefecto() {
      const nombre = R.util.norm((R.estado.perfil && R.estado.perfil.nombre) || "");
      return D.opciones("facturo").find(o => nombre.startsWith(R.util.norm(o))) || "";
    },
    aliasPorDefecto() { return D.opciones("alias")[0] || ""; },

    // ---------- Cambios ----------
    async crear(datos) {
      const p = D.poner(await R.api.pedidos.crear(datos));
      const id = pila.registrar({
        texto: `Alta de ${p.cliente}`,
        deshacer: async () => { await R.api.pedidos.borrar(p.id); D.quitar(p.id); R.app.refrescar(); },
      });
      toast(`Pedido de ${p.cliente} cargado.`, "ok", 5000, { texto: "Deshacer", fn: () => pila.ejecutar(id) });
      R.app.contadores();
      return p;
    },
    // Corrige datos (no el estado). Devuelve el pedido actualizado.
    async actualizar(p, cambios, { avisar = false } = {}) {
      const antes = {};
      Object.keys(cambios).forEach(k => { antes[k] = p[k]; });
      let nuevo = await R.api.pedidos.actualizar(p.id, cambios);
      // Si se pasó a otra sucursal, deja de verse acá
      if (nuevo.sucursal !== R.estado.sucursal) D.quitar(p.id); else D.poner(nuevo);
      const campos = Object.keys(cambios).map(k => CAMPOS[k] || k).join(", ");
      const id = pila.registrar({
        texto: `${campos} de ${nuevo.cliente}`,
        deshacer: async () => { D.poner(await R.api.pedidos.actualizar(p.id, antes)); R.app.refrescar(); },
      });
      if (avisar) toast(`Guardado: ${campos}.`, "ok", 5000, { texto: "Deshacer", fn: () => pila.ejecutar(id) });
      return nuevo;
    },
    async borrar(p) {
      await R.api.pedidos.borrar(p.id);
      D.quitar(p.id);
      toast(`Se borró el pedido de ${p.cliente}.`);
      R.app.refrescar();
    },
    // Cambio de estado (fac_accion), con "Deshacer" = volver un paso
    async accion(p, accion, datos = {}) {
      const nuevo = D.poner(await R.api.pedidos.accion(p.id, accion, datos));
      const texto = ACCIONES[accion] || accion;
      const id = pila.registrar({
        texto: `${texto} (${p.cliente})`,
        deshacer: async () => { D.poner(await R.api.pedidos.accion(p.id, "volver")); R.app.refrescar(); },
      });
      toast(`${texto}: ${p.cliente}.`, "ok", 6000, { texto: "Deshacer", fn: () => pila.ejecutar(id) });
      R.app.refrescar();
      return nuevo;
    },

    // ---------- Acciones que piden datos ----------
    async despachar(p) {
      const comis = /COMISIONISTA|RETIRA/i.test(R.util.norm(p.transporte));
      const v = await formulario({
        titulo: `Despachar: ${p.cliente}`,
        texto: comis ? "Si lo retira el comisionista, tildá que firmó el remito." : "Cargá el número de guía del transporte (se puede completar después).",
        campos: [
          { id: "fecha", label: "Fecha de despacho", tipo: "date", valor: hoy(), min: p.fecha, max: hoy(), requerido: true },
          { id: "guia", label: "N° de guía", tipo: "text", valor: p.guia || "", placeholder: "Ej. 3600-12345678", foco: !comis },
          { id: "remito_firmado", label: "El comisionista firmó el remito", tipo: "checkbox", valor: p.remito_firmado || comis, oculto: !comis },
        ],
        boton: "Marcar despachado",
      });
      if (!v) return null;
      return D.accion(p, "despachar", v);
    },
    async darDeBaja(p) {
      const v = await formulario({
        titulo: `Dar de baja: ${p.cliente}`,
        texto: "El pedido pasa a Baja y se desarma. Emití la nota de crédito y cargá su número (si todavía no lo tenés, se carga después).",
        campos: [
          { id: "nota_credito", label: "N° de nota de crédito", tipo: "text", valor: p.nota_credito || "", placeholder: "Ej. NC 0003-00001234" },
          { id: "motivo", label: "Motivo", tipo: "text", valor: p.t2_en ? "Sin respuesta al T2" : "", placeholder: "Ej. Sin respuesta al T2" },
        ],
        boton: "Dar de baja",
        peligro: true,
      });
      if (!v) return null;
      return D.accion(p, "baja", v);
    },
    async cargarNC(p) {
      const v = await formulario({
        titulo: `Nota de crédito: ${p.cliente}`,
        campos: [{ id: "nota_credito", label: "N° de nota de crédito", tipo: "text", valor: p.nota_credito || "", requerido: true }],
        boton: "Guardar",
      });
      if (!v) return null;
      const r = await D.actualizar(p, { nota_credito: v.nota_credito }, { avisar: true });
      R.app.refrescar();
      return r;
    },
  };

  const ACCIONES = {
    t1: "T1 enviado", t2: "T2 enviado", informar_pago: "Pago informado", confirmar_pago: "Pago confirmado",
    rechazar_pago: "Pago no recibido", despachar: "Despachado", baja: "Dado de baja", volver: "Se volvió un paso",
  };
  const CAMPOS = {
    numero: "N° de pedido", tipo: "Tipo", fecha: "Fecha", cliente: "Cliente", cliente_id: "Cliente", telefono: "Teléfono",
    transporte: "Transporte", facturo: "Facturó", armador: "Armador", importe_1: "Parte 1", importe_2: "Parte 2",
    alias_pago: "Alias", faltantes: "Faltantes", observaciones: "Observaciones", guia: "Guía", nota_credito: "Nota de crédito",
    remito_firmado: "Remito firmado", despacho_fecha: "Fecha de despacho", revisar: "Aviso para revisar", sucursal: "Sucursal",
    estado: "Estado", t1_en: "T1", t2_en: "T2", t3_en: "T3", pago_informado_en: "Pago informado",
    pago_confirmado_en: "Pago confirmado", pago_confirmado_por: "Confirmó", despachado_en: "Despachado",
    despachado_por: "Despachó", baja_en: "Baja", baja_por: "Dio de baja", motivo_baja: "Motivo de la baja",
  };
  D.CAMPOS = CAMPOS;
  D.ACCIONES = ACCIONES;

  // ---------- Diálogo con campos (despachar, baja, NC...) ----------
  // campos: [{ id, label, tipo: text|date|checkbox|textarea|select, valor, min, max, placeholder, requerido, opciones, oculto, hint }]
  // Devuelve { id: valor } o null si se cancela.
  function formulario({ titulo, texto = "", campos, boton = "Aceptar", peligro = false, validar }) {
    return new Promise(resolver => {
      const d = $("dlg-form");
      $("form-titulo").textContent = titulo;
      $("form-texto").textContent = texto;
      $("form-texto").hidden = !texto;
      $("form-error").textContent = "";
      $("form-campos").innerHTML = campos.map(c => {
        const id = "fc-" + c.id;
        if (c.tipo === "checkbox") {
          return `<div ${c.oculto ? "hidden" : ""} style="margin-top:12px"><label class="interruptor"><input type="checkbox" id="${id}" ${c.valor ? "checked" : ""}><span class="interruptor-pista"></span>${esc(c.label)}</label></div>`;
        }
        const req = c.requerido ? "required" : "";
        let control;
        if (c.tipo === "textarea") control = `<textarea id="${id}" rows="3" ${req} placeholder="${esc(c.placeholder || "")}">${esc(c.valor || "")}</textarea>`;
        else if (c.tipo === "select") control = `<select id="${id}" ${req}>${(c.opciones || []).map(o => `<option ${o === c.valor ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        else control = `<input type="${c.tipo || "text"}" id="${id}" value="${esc(c.valor ?? "")}" ${req} ${c.min ? `min="${esc(c.min)}"` : ""} ${c.max ? `max="${esc(c.max)}"` : ""} placeholder="${esc(c.placeholder || "")}" maxlength="200">`;
        return `<div ${c.oculto ? "hidden" : ""}><label for="${id}">${esc(c.label)}</label>${control}${c.hint ? `<p class="hint">${esc(c.hint)}</p>` : ""}</div>`;
      }).join("");
      const ok = $("form-ok");
      ok.textContent = boton;
      ok.classList.toggle("peligro", peligro);
      let respuesta = null;
      $("form-dlg").onsubmit = e => {
        e.preventDefault();
        const v = {};
        campos.forEach(c => {
          const el = $("fc-" + c.id);
          v[c.id] = c.tipo === "checkbox" ? el.checked : el.value.trim();
        });
        const error = validar && validar(v);
        if (error) { $("form-error").textContent = error; return; }
        respuesta = v;
        d.close();
      };
      d.onclose = () => resolver(respuesta);
      d.showModal();
      const primero = campos.find(c => c.foco) || campos.find(c => !c.oculto && c.tipo !== "checkbox");
      if (primero) { const el = $("fc-" + primero.id); el.focus(); if (el.select) el.select(); }
    });
  }
  R.util.formulario = formulario;

  R.datos = D;
})(window.FAC);
