window.FAC = window.FAC || {};

(function (R) {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  // Usuario <-> email de login. "greisy" -> "greisy@rotulos.cindymayorista.com.ar"
  const dominioUsuarios = () => ((window.FAC_CONFIG || {}).dominioUsuarios || "rotulos.cindymayorista.com.ar").toLowerCase();
  const aEmail = u => {
    const s = String(u || "").trim().toLowerCase();
    return s.includes("@") ? s : `${s}@${dominioUsuarios()}`;
  };
  const aUsuario = email => {
    const s = String(email || "").toLowerCase(), sufijo = "@" + dominioUsuarios();
    return s.endsWith(sufijo) ? s.slice(0, -sufijo.length) : s;
  };

  // ---------- Fechas y números (hora de Argentina) ----------
  const ZONA = "America/Argentina/Cordoba";
  const iso = d => d.toLocaleDateString("en-CA", { timeZone: ZONA }); // YYYY-MM-DD
  const hoy = () => iso(new Date());
  const fmtFecha = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";
  const fmtFechaCorta = s => s ? String(s).slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "—";
  const fmtHora = t => t ? new Date(t).toLocaleTimeString("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" }) : "";
  const fechaHora = t => t ? new Date(t).toLocaleString("es-AR", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtNum = (n, dec = 0) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  const fmtPesos = (n, dec = 0) => n == null ? "—" : "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // $ 1,2 M / $ 850 mil: para ejes y barras
  const fmtPesosCorto = n => {
    const v = Number(n || 0), a = Math.abs(v);
    if (a >= 1e6) return "$ " + (v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
    if (a >= 1e4) return "$ " + Math.round(v / 1e3).toLocaleString("es-AR") + " mil";
    return fmtPesos(v);
  };
  const fmtPct = (n, dec = 1) => n == null ? "—" : (n * 100).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec }) + " %";
  const plural = (n, uno, varios) => `${fmtNum(n)} ${n === 1 ? uno : varios}`;
  // "hace 3 días", "hoy", "ayer"
  function hace(t) {
    const dias = Math.round((Date.parse(hoy()) - Date.parse(iso(new Date(t)))) / 86400000);
    if (dias <= 0) return "hoy, " + fmtHora(t);
    if (dias === 1) return "ayer, " + fmtHora(t);
    return `hace ${dias} días`;
  }
  // Para <input type="datetime-local"> en hora argentina
  const aInputFechaHora = t => {
    const d = new Date(t || Date.now());
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  // Lo que se escribió en datetime-local, en hora argentina (UTC-3, sin horario de verano)
  const deInputFechaHora = v => v ? new Date(v + ":00-03:00").toISOString() : null;
  // Monto escrito a mano: "49.900", "49900,50", "$ 1.200" -> número
  function leerMonto(v) {
    let s = String(v ?? "").replace(/[^\d.,-]/g, "");
    if (!s) return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  let timerToast;
  function toast(mensaje, tipo = "ok", ms = 3500, accion) {
    const el = $("toast");
    if (accion) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "toast-accion"; b.textContent = accion.texto;
      b.addEventListener("click", () => { el.hidden = true; accion.fn(); });
      el.replaceChildren(document.createTextNode(mensaje), b);
    } else el.textContent = mensaje;
    el.classList.toggle("error", tipo === "error");
    el.hidden = false;
    // Con una ficha abierta (diálogo modal) el aviso tiene que quedar arriba de ella: se muestra como popover
    if (el.showPopover) {
      if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
      try { if (el.matches(":popover-open")) el.hidePopover(); el.showPopover(); } catch (e) { /* sin soporte: queda como aviso común */ }
    }
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { el.hidden = true; try { if (el.matches(":popover-open")) el.hidePopover(); } catch (e) {} }, ms);
  }

  // CSV para Excel en español: separador ";" y BOM para que respete las tildes
  function descargarCSV(nombreArchivo, filas) {
    const celda = v => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const texto = "﻿" + filas.map(f => f.map(celda).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    a.download = nombreArchivo;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function iniciarDialogos() {
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-cerrar]");
      if (b) b.closest("dialog").close();
    });
  }

  // Confirmación con un diálogo propio (no el confirm() del navegador). Devuelve el texto escrito o null.
  function pedir({ titulo, texto, campo, boton = "Aceptar", peligro = false }) {
    return new Promise(resolver => {
      const d = $("dlg-pedir");
      $("pedir-titulo").textContent = titulo;
      $("pedir-texto").textContent = texto || "";
      const input = $("pedir-campo");
      $("pedir-campo-wrap").hidden = !campo;
      $("pedir-campo-label").textContent = campo || "";
      input.value = "";
      const ok = $("pedir-ok");
      ok.textContent = boton;
      ok.classList.toggle("peligro", peligro);
      let respuesta = null;
      const aceptar = e => {
        e.preventDefault();
        if (campo && !input.value.trim()) { input.focus(); return; }
        respuesta = campo ? input.value.trim() : "";
        d.close();
      };
      $("form-pedir").onsubmit = aceptar;
      d.onclose = () => resolver(respuesta);
      d.showModal();
      (campo ? input : ok).focus();
    });
  }

  // Íconos de interfaz (Lucide, SVG en línea; nunca emojis)
  const svg = cuerpo => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;
  const ICONOS = {
    whatsapp: svg(`<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>`),
    instagram: svg(`<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>`),
    mensaje: svg(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`),
    copiar: svg(`<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
    mas: svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
    basura: svg(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`),
    descarga: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`),
    camion: svg(`<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>`),
    billete: svg(`<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>`),
    check: svg(`<path d="M20 6 9 17l-5-5"/>`),
    reloj: svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
    alerta: svg(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`),
    deshacer: svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
    abrir: svg(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`),
    imprimir: svg(`<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>`),
    x: svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
    columnas: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>`),
  };
  const iconoCanal = () => ICONOS.mensaje;

  // Estado de un pedido (columna estado de fac_pedidos)
  const ESTADOS = {
    facturado: "Facturado", esperando_pago: "Esperando pago", pago_informado: "Pago informado",
    listo: "Listo para despachar", despachado: "Despachado", baja: "Baja",
  };
  const chipEstado = e => `<span class="estado ${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

  // ---------- Ayudas "i" y globos de los gráficos ----------
  const info = texto => `<span class="info" tabindex="0" role="img" aria-label="${esc(texto)}" data-info="${esc(texto)}"></span>`;

  function iniciarAyudas() {
    const globo = document.createElement("div");
    globo.className = "globo-info";
    globo.setAttribute("role", "tooltip");
    globo.hidden = true;
    let actual = null, cuadro = 0, ultimo = null, ocultando = 0;
    // Los "i" y lo que tenga data-tip. Si un elemento con data-tip está dentro de otro (ej. el "i" dentro de un
    // indicador), gana el de adentro.
    const SEL = ".info[data-info], [data-tip]";

    // El texto puede tener varias líneas ("\n"): la primera va como título
    function pintarTexto(el) {
      const lineas = String(el.dataset.info || el.dataset.tip || "").split("\n").filter(Boolean);
      globo.classList.toggle("con-titulo", lineas.length > 1);
      globo.innerHTML = lineas.length > 1
        ? `<strong>${esc(lineas[0])}</strong>` + lineas.slice(1).map(l => `<span>${esc(l)}</span>`).join("")
        : esc(lineas[0] || "");
    }
    // Ubica el globo arriba del puntero (o del elemento), sin salirse de la pantalla; si no entra arriba, va abajo
    function colocar(x, y) {
      const el = actual;
      if (!el) return;
      const r = el.getBoundingClientRect(), g = globo.getBoundingClientRect(), m = 8;
      const sigue = x != null;   // los gráficos siguen al puntero; los "i" quedan fijos sobre el ícono
      const cx = sigue ? x : r.left + r.width / 2, arriba = sigue ? y - 14 : r.top - 8, abajo = sigue ? y + 22 : r.bottom + 8;
      const left = Math.max(m, Math.min(cx - g.width / 2, window.innerWidth - g.width - m));
      let top = arriba - g.height;
      if (top < m) top = Math.min(abajo, window.innerHeight - g.height - m);
      globo.style.left = `${Math.round(left)}px`;
      globo.style.top = `${Math.round(top)}px`;
    }
    function mostrar(el, x, y) {
      clearTimeout(ocultando);
      const destino = el.closest("dialog[open]") || document.body;
      // Se mueve al lugar correcto una sola vez: volver a insertarlo reinicia la animación y parpadea
      if (globo.parentElement !== destino) destino.appendChild(globo);
      if (el !== actual) { actual = el; pintarTexto(el); }
      globo.hidden = false;
      colocar(x, y);
    }
    function ocultar(demora = 0) {
      clearTimeout(ocultando);
      const fin = () => { actual = null; globo.hidden = true; };
      if (demora) ocultando = setTimeout(fin, demora); else fin();
    }
    const tipDe = t => (t && t.closest ? t.closest(SEL) : null);

    document.addEventListener("mouseover", e => {
      const el = tipDe(e.target);
      if (el && el === actual) clearTimeout(ocultando);   // volvió enseguida al mismo: no se apaga
      else if (el) mostrar(el, el.dataset.tip ? e.clientX : undefined, el.dataset.tip ? e.clientY : undefined);
    });
    // Mover el mouse solo reubica (una vez por cuadro de pantalla)
    document.addEventListener("mousemove", e => {
      if (!actual || !actual.dataset.tip) return;
      ultimo = e;
      if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; if (actual && ultimo) colocar(ultimo.clientX, ultimo.clientY); });
    });
    // Al pasar de una barra a la de al lado (o por el hueco entre las dos) no se apaga y se vuelve a prender
    document.addEventListener("mouseout", e => {
      const el = tipDe(e.target);
      if (!el || el !== actual || el.contains(e.relatedTarget)) return;
      if (tipDe(e.relatedTarget)) return;   // el mouseover del nuevo lo cambia
      ocultar(120);
    });
    // En el celular: tocar muestra el globo; tocar fuera lo cierra
    document.addEventListener("touchstart", e => {
      const el = e.target.closest("[data-tip], .info[data-info]");
      if (el) { const t = e.touches[0]; mostrar(el, el.dataset.tip ? t.clientX : undefined, el.dataset.tip ? t.clientY : undefined); }
      else if (actual) ocultar();
    }, { passive: true });
    document.addEventListener("focusin", e => { if (e.target.matches(".info[data-info]:focus-visible, [data-tip]:focus-visible")) mostrar(e.target); });
    document.addEventListener("focusout", e => { if (e.target === actual) ocultar(); });
    document.addEventListener("scroll", () => { if (actual) ocultar(); }, true);
    window.addEventListener("blur", () => { if (actual) ocultar(); });
  }

  // ---------- Tema: automático → claro → oscuro ----------
  // Predeterminado: claro (no sigue al sistema). El botón alterna claro <-> oscuro y se recuerda en este navegador.
  // El ícono muestra el tema al que se pasa (luna en claro, sol en oscuro).
  const TEMAS = {
    oscuro: { siguiente: "claro", texto: "oscuro", icono: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`) },
    claro: { siguiente: "oscuro", texto: "claro", icono: svg(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`) },
  };
  const temaActual = () => (document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro");
  function pintarBotonesTema() {
    const t = TEMAS[temaActual()];
    document.querySelectorAll("[data-tema-boton]").forEach(b => {
      b.innerHTML = t.icono;
      const texto = `Cambiar a tema ${TEMAS[t.siguiente].texto}`;
      b.title = texto;
      b.setAttribute("aria-label", texto);
    });
  }
  function iniciarTema() {
    pintarBotonesTema();
    coloresEstado.aplicar();
    document.addEventListener("click", e => {
      if (!e.target.closest("[data-tema-boton]")) return;
      const nuevo = TEMAS[temaActual()].siguiente;
      document.documentElement.dataset.tema = nuevo;
      try { if (nuevo === "claro") localStorage.removeItem("fac-tema"); else localStorage.setItem("fac-tema", nuevo); } catch (err) {}
      pintarBotonesTema();
      coloresEstado.aplicar();
      document.dispatchEvent(new CustomEvent("fac-tema"));
    });
  }

  // Preferencias de esta persona en este navegador (local elegido, vendedor, filtros)
  const pref = {
    leer(clave, defecto) { try { const v = localStorage.getItem("fac-" + clave); return v == null ? defecto : JSON.parse(v); } catch (e) { return defecto; } },
    guardar(clave, valor) { try { localStorage.setItem("fac-" + clave, JSON.stringify(valor)); } catch (e) {} },
    borrar(clave) { try { localStorage.removeItem("fac-" + clave); } catch (e) {} },
  };

  // ---------- Colores de los estados, a gusto de cada persona (en este navegador) ----------
  // Se eligen tocando el cuadradito de la leyenda de la planilla. Cada tema (claro / oscuro) tiene su propia
  // paleta; lo elegido pisa las variables --e-* de css/facturacion.css, así cambian filas, chips y leyenda juntos.
  const VAR_ESTADO = {
    facturado: "--e-facturado", esperando_pago: "--e-esperando", pago_informado: "--e-informado",
    listo: "--e-listo", despachado: "--e-despachado", baja: "--e-baja",
  };
  const esHex = c => /^#[0-9a-f]{6}$/i.test(c || "");
  const coloresEstado = {
    elegidos() { const e = pref.leer("colores-" + temaActual(), {}); return e && typeof e === "object" ? e : {}; },
    aplicar() {
      const elegidos = this.elegidos();
      const raiz = document.documentElement.style;
      Object.entries(VAR_ESTADO).forEach(([k, v]) => { if (esHex(elegidos[k])) raiz.setProperty(v, elegidos[k]); else raiz.removeProperty(v); });
    },
    // Color que se ve ahora (elegido o el de fábrica), en #rrggbb para el selector de color
    actual(k) {
      const c = getComputedStyle(document.documentElement).getPropertyValue(VAR_ESTADO[k]).trim().toLowerCase();
      if (esHex(c)) return c;
      if (/^#[0-9a-f]{3}$/.test(c)) return "#" + [...c.slice(1)].map(x => x + x).join("");
      return "#888888";
    },
    // guardar=false: solo se prueba en pantalla (mientras se arrastra en el selector)
    cambiar(k, color, guardar = true) {
      if (!VAR_ESTADO[k] || !esHex(color)) return;
      document.documentElement.style.setProperty(VAR_ESTADO[k], color);
      if (guardar) pref.guardar("colores-" + temaActual(), { ...this.elegidos(), [k]: color.toLowerCase() });
    },
    personalizados() { return Object.keys(this.elegidos()).some(k => VAR_ESTADO[k]); },
    restablecer() { pref.borrar("colores-" + temaActual()); this.aplicar(); },
  };

  // ---------- Esqueletos de carga ----------
  const ANCHOS = [72, 48, 86, 60, 40, 78, 54, 66, 90, 45];
  const barra = (ancho, alto = 12, extra = "") => `<span class="esq" style="width:${ancho}${typeof ancho === "number" ? "%" : ""}; height:${alto}px${extra}"></span>`;
  const aviso = `<span class="sr-only">Cargando…</span>`;
  const esqueleto = {
    kpis(n = 4) {
      return aviso + Array.from({ length: n }, (_, i) => `<div class="kpi" aria-hidden="true">${barra(55 + (i % 3) * 10, 10)}${barra(38, 28, "; margin-top:12px")}${barra(70 - (i % 2) * 15, 10, "; margin-top:10px")}</div>`).join("");
    },
    filas(cols, n = 6) {
      return Array.from({ length: n }, (_, f) => `<tr class="esq-fila" aria-hidden="true">${Array.from({ length: cols }, (_, c) =>
        `<td>${barra(ANCHOS[(f + c) % 10] - 10, 12)}</td>`).join("")}</tr>`).join("");
    },
    tarjetas(n = 3) {
      return aviso + Array.from({ length: n }, (_, i) => `<div class="tarjeta-consulta" aria-hidden="true">${barra(50 + (i % 3) * 10, 14)}${barra(80, 10)}${barra(36, 34, "; border-radius:8px")}</div>`).join("");
    },
    grafico(alto = 180) { return `<span class="esq" style="width:100%; height:${alto}px; border-radius:10px"></span>`; },
  };

  R.util = {
    $, esc, norm, aEmail, aUsuario, ZONA, iso, hoy, fmtFecha, fmtFechaCorta, fmtHora, fechaHora, fmtNum, fmtPesos, fmtPesosCorto, fmtPct,
    plural, hace, aInputFechaHora, deInputFechaHora, leerMonto, toast, descargarCSV, iniciarDialogos, pedir, svg, ICONOS, iconoCanal,
    ESTADOS, chipEstado, info, iniciarAyudas, iniciarTema, pref, coloresEstado, esqueleto,
  };
})(window.FAC);
