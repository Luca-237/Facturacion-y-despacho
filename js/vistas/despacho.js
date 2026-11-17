// =====================================================================
//  Despacho: pedidos con el pago confirmado, lista para Facu y Lorenzo
//  (copiar, WhatsApp o imprimir con casilleros) y despachados del día.
// =====================================================================
(function (R) {
  const { $, esc, fmtPesos, fechaHora, ICONOS, toast, hoy } = R.util;
  const M = window.FacMensajes, P = window.FacPlazos;
  const pesos = n => (n == null ? "—" : fmtPesos(n, Math.round(n * 100) % 100 ? 2 : 0));
  const fuera = new Set();   // ids destildados (no salen en esta ventana)

  const listos = () => R.datos.pedidos.filter(p => p.estado === "listo")
    .sort((a, b) => String(a.pago_confirmado_en).localeCompare(String(b.pago_confirmado_en)));
  const elegidos = () => listos().filter(p => !fuera.has(p.id));
  const ventana = () => $("desp-ventana").value;

  function mostrar() {
    const aj = R.datos.ajustes();
    const prox = P.proximaVentana(aj);
    const sel = $("desp-ventana"), antes = sel.value;
    sel.innerHTML = (aj.ventanas || []).map(v => `<option ${v === (antes || (prox && prox.hora)) ? "selected" : ""}>${esc(v)}</option>`).join("");
    const l = listos();
    const total = l.reduce((s, p) => s + (p.total || 0), 0);
    $("desp-sub").textContent = l.length
      ? `${l.length} ${l.length === 1 ? "pedido listo" : "pedidos listos"} (${pesos(total)}). Próxima ventana: ${prox ? prox.hora + " " + (prox.dia === "hoy" || prox.dia === "mañana" ? prox.dia : R.util.fmtFecha(prox.dia)) : "—"}.`
      : "No hay pedidos con el pago confirmado esperando despacho.";
    const carga = R.app.puedeCargar();
    $("desp-cuerpo").innerHTML = l.length ? l.map(p => `<tr>
        <td><input type="checkbox" data-elegir="${p.id}" ${fuera.has(p.id) ? "" : "checked"} aria-label="Incluir en la lista"></td>
        <td><button type="button" class="link" data-abrir="${p.id}">${esc(p.cliente)}</button>${p.numero ? `<small>N° ${esc(p.numero)}</small>` : ""}</td>
        <td>${esc(p.transporte || "—")}</td>
        <td class="num">${pesos(p.total)}</td>
        <td>${fechaHora(p.pago_confirmado_en)}<small>${esc(R.datos.nombrePersona(p.pago_confirmado_por))}</small></td>
        <td>${esc(p.observaciones || "")}${p.faltantes ? `<small>Faltantes: ${esc(p.faltantes)}</small>` : ""}</td>
        <td>${carga ? `<button type="button" class="btn-sec primario" data-despachar="${p.id}">${ICONOS.camion}Despachado</button>` : ""}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="vacio" style="padding:18px">Nada para despachar.</td></tr>`;
    $("desp-todos").checked = l.length > 0 && !l.some(p => fuera.has(p.id));
    ["desp-copiar", "desp-whatsapp", "desp-imprimir"].forEach(id => { $(id).disabled = !elegidos().length; });

    const d = hoy();
    const hechos = R.datos.pedidos.filter(p => p.estado === "despachado" && p.despacho_fecha === d)
      .sort((a, b) => String(b.despachado_en).localeCompare(String(a.despachado_en)));
    $("desp-hoy").innerHTML = hechos.length ? `<ul class="tareas">${hechos.map(p => `<li class="tarea">
        <div class="tarea-info"><button type="button" class="tarea-cliente" data-abrir="${p.id}">${esc(p.cliente)}</button>
          <span class="tarea-meta">${esc(p.transporte || "")} · ${p.guia ? "guía " + esc(p.guia) : p.remito_firmado ? "remito firmado" : "sin guía cargada"}</span></div>
        <strong class="tarea-total">${pesos(p.total)}</strong>
        <div class="tarea-acciones">${carga && !p.guia && !p.remito_firmado ? `<button type="button" class="btn-sec" data-guia="${p.id}">${ICONOS.mas}Cargar guía</button>` : ""}</div>
      </li>`).join("")}</ul>` : `<p class="vacio">Todavía no se despachó nada hoy.</p>`;
  }

  function texto() { return M.listaDespacho(elegidos(), ventana()); }

  function imprimir() {
    const l = elegidos();
    const filas = l.map(p => `<tr><td class="cas">&#9744;</td><td><strong>${esc(p.cliente)}</strong>${p.numero ? ` <span>N° ${esc(p.numero)}</span>` : ""}</td>
      <td>${esc(p.transporte || "")}</td><td class="num">${pesos(p.total)}</td><td>${esc(p.observaciones || "")}</td></tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) return toast("El navegador bloqueó la ventana de impresión: permití las ventanas emergentes.", "error");
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Despacho ${esc(ventana())}</title>
      <style>body{font:14px Arial,sans-serif;padding:24px;max-width:760px;margin:0 auto;color:#111}h1{font-size:18px;margin:0 0 4px}
      p{color:#555;margin:0 0 16px}table{width:100%;border-collapse:collapse}th,td{border:1.5px solid #333;padding:8px 10px;text-align:left;vertical-align:middle}
      th{background:#eee;font-size:12px;text-transform:uppercase}td.cas{width:28px;text-align:center;font-size:20px}td.num{text-align:right;white-space:nowrap}
      td span{color:#666;font-size:12px}.pie{margin-top:16px;font-size:11px;color:#888}</style></head><body>
      <h1>Cindy Mayorista · Lista de despacho</h1>
      <p>Ventana de las ${esc(ventana())} · ${new Date().toLocaleDateString("es-AR", { timeZone: R.util.ZONA })} · ${l.length} ${l.length === 1 ? "pedido" : "pedidos"}</p>
      <table><thead><tr><th></th><th>Cliente</th><th>Transporte</th><th>Total</th><th>Observaciones</th></tr></thead><tbody>${filas}</tbody></table>
      <p class="pie">Impreso desde Facturación y despacho · ${new Date().toLocaleString("es-AR", { timeZone: R.util.ZONA })}</p>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  function iniciar() {
    $("desp-copiar").innerHTML = ICONOS.copiar + "Copiar lista para Facu / Lorenzo";
    $("desp-whatsapp").innerHTML = ICONOS.whatsapp + "Abrir en WhatsApp";
    $("desp-imprimir").innerHTML = ICONOS.imprimir + "Imprimir con casilleros";
    $("desp-ventana").addEventListener("change", mostrar);
    $("desp-copiar").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(texto()); toast("Lista copiada."); } catch (e) { toast(e.message, "error"); }
    });
    $("desp-whatsapp").addEventListener("click", () => window.open(M.linkWhatsapp("", texto()), "_blank", "noopener"));
    $("desp-imprimir").addEventListener("click", imprimir);
    $("desp-todos").addEventListener("change", e => {
      listos().forEach(p => { if (e.target.checked) fuera.delete(p.id); else fuera.add(p.id); });
      mostrar();
    });
    $("vista-despacho").addEventListener("change", e => {
      const c = e.target.closest("[data-elegir]");
      if (!c) return;
      const id = Number(c.dataset.elegir);
      if (c.checked) fuera.delete(id); else fuera.add(id);
      mostrar();
    });
    $("vista-despacho").addEventListener("click", async e => {
      const a = e.target.closest("[data-abrir]");
      if (a) return R.vistaPedido.abrir(Number(a.dataset.abrir));
      const d = e.target.closest("[data-despachar]");
      const g = e.target.closest("[data-guia]");
      const p = d ? R.datos.porId(Number(d.dataset.despachar)) : g ? R.datos.porId(Number(g.dataset.guia)) : null;
      if (!p) return;
      try {
        if (d) await R.datos.despachar(p);
        else {
          const v = await R.util.formulario({ titulo: `Guía: ${p.cliente}`, campos: [{ id: "guia", label: "N° de guía", tipo: "text", requerido: true }], boton: "Guardar" });
          if (v) { await R.datos.actualizar(p, v, { avisar: true }); R.app.refrescar(); }
        }
      } catch (err) { toast(err.message, "error"); }
    });
  }

  R.vistaDespacho = { iniciar, mostrar, cantidad: () => listos().length };
})(window.FAC);
