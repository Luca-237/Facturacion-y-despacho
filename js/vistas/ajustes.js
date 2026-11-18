// =====================================================================
//  Ajustes (solo admin): plazos hábiles y feriados (comunes), ventanas y
//  listas de la sucursal elegida, y quién usa facturación con qué rol y
//  en qué sucursales.
// =====================================================================
(function (R) {
  const { $, esc, toast } = R.util;
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const LISTAS = [["facturo", "Facturó"], ["armador", "Armadores"], ["alias", "Alias de pago"]];
  const ROLES = [["", "Sin acceso"], ["facturacion", "Facturación"], ["administracion", "Administración"], ["consulta", "Consulta"]];
  let lista = "facturo";
  let borrador = null;   // { noHabiles:Set, feriados:[] } mientras se edita

  function pintarPlazos() {
    const a = R.datos.ajustes();
    if (!borrador) borrador = { noHabiles: new Set(a.dias_no_habiles || []), feriados: [...(a.feriados || [])].sort() };
    $("aj-t2").value = a.horas_t2;
    $("aj-t3").value = a.horas_t3;
    $("aj-ventanas-label").textContent = `Ventanas de despacho de ${R.datos.nombreSucursal()}`;
    $("aj-ventanas").value = (a.ventanas || []).join(", ");
    $("aj-no-habiles").innerHTML = DIAS.map((d, i) => `<button type="button" class="pastilla" data-dia="${i}" aria-pressed="${borrador.noHabiles.has(i)}">${d}</button>`).join("");
    pintarFeriados();
  }
  function pintarFeriados() {
    $("aj-feriados").innerHTML = borrador.feriados.length
      ? borrador.feriados.map(f => `<span class="chip-quitar">${R.util.fmtFecha(f)}<button type="button" data-quitar-feriado="${f}" aria-label="Quitar ${f}">${R.util.ICONOS.x}</button></span>`).join("")
      : `<p class="hint">Sin feriados cargados.</p>`;
  }

  async function guardarPlazos() {
    const t2 = Number($("aj-t2").value), t3 = Number($("aj-t3").value);
    const ventanas = $("aj-ventanas").value.split(/[,;\s]+/).map(v => v.trim()).filter(Boolean);
    if (!(t2 >= 1 && t2 <= 240) || !(t3 >= 1 && t3 <= 240)) return toast("Las horas tienen que estar entre 1 y 240.", "error");
    if (!ventanas.every(v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v))) return toast("Las ventanas van como 10:00, 15:00.", "error");
    if (borrador.noHabiles.size >= 7) return toast("Tiene que quedar al menos un día hábil.", "error");
    const comunes = { horas_t2: t2, horas_t3: t3, dias_no_habiles: [...borrador.noHabiles].sort(), feriados: borrador.feriados };
    const ventanasSucursal = ventanas.map(v => v.padStart(5, "0")).sort();
    try {
      for (const [clave, valor] of Object.entries(comunes)) await R.api.admin.guardarAjuste(clave, valor);
      const s = await R.api.admin.guardarVentanas(R.estado.sucursal, ventanasSucursal);
      R.estado.catalogo.ajustes = { ...R.estado.catalogo.ajustes, ...comunes };
      const suc = R.datos.sucursal();
      if (suc) suc.ventanas = s.ventanas;
      borrador = null;
      pintarPlazos();
      toast(`Plazos guardados, y ventanas de ${R.datos.nombreSucursal()}.`);
      R.app.contadores();
    } catch (e) { toast(e.message, "error"); }
  }

  function pintarLista() {
    $("aj-listas-titulo").textContent = `Listas de ${R.datos.nombreSucursal()}`;
    $("aj-pestanas").innerHTML = LISTAS.map(([k, t]) => `<button type="button" role="tab" data-lista="${k}" aria-selected="${k === lista}">${t}</button>`).join("");
    const ops = R.estado.catalogo.opciones.filter(o => o.tipo === lista && o.sucursal === R.estado.sucursal)
      .sort((a, b) => a.orden - b.orden || a.valor.localeCompare(b.valor));
    $("aj-lista").innerHTML = ops.map(o => `<li data-id="${o.id}" class="${o.activo ? "" : "inactivo"}">
        <input type="text" value="${esc(o.valor)}" maxlength="60" data-campo="valor" aria-label="Nombre">
        <input type="number" value="${o.orden}" min="0" max="999" data-campo="orden" aria-label="Orden">
        <label class="interruptor"><input type="checkbox" data-campo="activo" ${o.activo ? "checked" : ""}><span class="interruptor-pista"></span>Activa</label>
      </li>`).join("") || `<li class="vacio">Lista vacía en ${esc(R.datos.nombreSucursal())}: agregá los nombres abajo.</li>`;
    $("aj-nuevo").placeholder = lista === "alias" ? "Nuevo alias" : "Nuevo nombre";
  }

  async function guardarOpcion(li) {
    const o = R.estado.catalogo.opciones.find(x => x.id === Number(li.dataset.id));
    if (!o) return;
    const datos = { ...o, valor: li.querySelector('[data-campo="valor"]').value.trim(), orden: Number(li.querySelector('[data-campo="orden"]').value) || 0, activo: li.querySelector('[data-campo="activo"]').checked };
    if (!datos.valor) return toast("El nombre no puede quedar vacío.", "error");
    try {
      Object.assign(o, await R.api.admin.guardarOpcion(datos));
      li.classList.toggle("inactivo", !o.activo);
      toast("Guardado.");
    } catch (e) { toast(e.message, "error"); pintarLista(); }
  }

  function pintarUsuarios() {
    const sucursales = ((R.estado.catalogo && R.estado.catalogo.sucursales) || []).filter(s => s.activa);
    const personas = [...(R.estado.catalogo.personas || [])].sort((a, b) => (a.rol_rotulos === "superadmin" ? -1 : 0) - (b.rol_rotulos === "superadmin" ? -1 : 0) || a.nombre.localeCompare(b.nombre));
    $("aj-usuarios").innerHTML = personas.map(p => {
      const admin = p.rol_rotulos === "superadmin";
      const control = admin
        ? `<span class="estado listo">Admin</span>`
        : `<select data-rol="${p.id}" aria-label="Rol de ${esc(p.nombre)}">${ROLES.map(([k, t]) => `<option value="${k}" ${(p.rol || "") === k ? "selected" : ""}>${t}</option>`).join("")}</select>`;
      const suc = admin ? `<span class="hint">Todas</span>`
        : `<div class="sucursales-usuario">${sucursales.map(s => `<label class="check-suc"><input type="checkbox" data-suc-usuario="${p.id}" value="${esc(s.clave)}" ${(p.sucursales || []).includes(s.clave) ? "checked" : ""} ${p.rol ? "" : "disabled"}>${esc(s.nombre)}</label>`).join("")}</div>`;
      return `<tr><td>${esc(p.nombre)}</td><td>${esc(R.util.aUsuario(p.email))}</td><td>${admin ? "Superadmin" : "Operador"}</td><td>${control}</td><td>${suc}</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="vacio">Sin usuarios.</td></tr>`;
  }

  function mostrar() {
    borrador = null;
    pintarPlazos();
    pintarLista();
    pintarUsuarios();
  }

  function iniciar() {
    $("aj-no-habiles").addEventListener("click", e => {
      const b = e.target.closest("[data-dia]");
      if (!b) return;
      const d = Number(b.dataset.dia);
      if (borrador.noHabiles.has(d)) borrador.noHabiles.delete(d); else borrador.noHabiles.add(d);
      b.setAttribute("aria-pressed", borrador.noHabiles.has(d));
    });
    $("aj-feriado-agregar").addEventListener("click", () => {
      const f = $("aj-feriado").value;
      if (!f) return;
      if (!borrador.feriados.includes(f)) borrador.feriados = [...borrador.feriados, f].sort();
      $("aj-feriado").value = "";
      pintarFeriados();
    });
    $("aj-feriados").addEventListener("click", e => {
      const b = e.target.closest("[data-quitar-feriado]");
      if (!b) return;
      borrador.feriados = borrador.feriados.filter(f => f !== b.dataset.quitarFeriado);
      pintarFeriados();
    });
    $("aj-guardar-plazos").addEventListener("click", guardarPlazos);
    $("aj-pestanas").addEventListener("click", e => {
      const b = e.target.closest("[data-lista]");
      if (b) { lista = b.dataset.lista; pintarLista(); }
    });
    $("aj-lista").addEventListener("change", e => { const li = e.target.closest("li[data-id]"); if (li) guardarOpcion(li); });
    $("aj-agregar").addEventListener("submit", async e => {
      e.preventDefault();
      const valor = $("aj-nuevo").value.trim();
      if (!valor) return;
      try {
        const orden = Math.max(0, ...R.estado.catalogo.opciones.filter(o => o.tipo === lista && o.sucursal === R.estado.sucursal).map(o => o.orden)) + 1;
        R.estado.catalogo.opciones.push(await R.api.admin.guardarOpcion({ tipo: lista, valor, orden, sucursal: R.estado.sucursal }));
        $("aj-nuevo").value = "";
        pintarLista();
        toast("Agregado.");
      } catch (err) { toast(err.message, "error"); }
    });
    $("aj-usuarios").addEventListener("change", async e => {
      const s = e.target.closest("[data-rol]");
      const c = e.target.closest("[data-suc-usuario]");
      if (s) {
        const p = R.estado.catalogo.personas.find(x => x.id === s.dataset.rol);
        // Al darle acceso por primera vez, arranca con la sucursal que se está viendo
        const sucursales = p && p.sucursales && p.sucursales.length ? p.sucursales : [R.estado.sucursal];
        try {
          await R.api.admin.asignarRol(s.dataset.rol, s.value || null, sucursales);
          if (p) { p.rol = s.value || null; p.activo = !!s.value; p.sucursales = s.value ? sucursales : []; }
          toast(s.value ? `${p ? p.nombre : "Usuario"}: ${s.options[s.selectedIndex].text}.` : `${p ? p.nombre : "Usuario"} ya no entra a facturación.`);
        } catch (err) { toast(err.message, "error"); }
        return pintarUsuarios();
      }
      if (c) {
        const id = c.dataset.sucUsuario;
        const p = R.estado.catalogo.personas.find(x => x.id === id);
        const elegidas = [...$("aj-usuarios").querySelectorAll(`[data-suc-usuario="${id}"]:checked`)].map(x => x.value);
        if (!elegidas.length) { c.checked = true; return toast("Tiene que quedar al menos una sucursal (o quitale el acceso con el rol).", "error"); }
        try {
          await R.api.admin.asignarSucursales(id, elegidas);
          if (p) p.sucursales = elegidas;
          toast(`${p ? p.nombre : "Usuario"}: ${elegidas.map(x => R.datos.nombreSucursal(x)).join(" y ")}.`);
        } catch (err) { toast(err.message, "error"); pintarUsuarios(); }
      }
    });
  }

  R.vistaAjustes = { iniciar, mostrar };
})(window.FAC);
