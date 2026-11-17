// =====================================================================
//  Arranque: sesión, rol en facturación y navegación entre secciones.
//    facturacion    -> Hoy, Planilla, Despacho (carga y cambia estados)
//    administracion -> Hoy (pagos a confirmar), Planilla y Despacho para mirar
//    consulta       -> todo para mirar
//    admin          -> todo, más Ajustes (los superadmin de rótulos)
// =====================================================================
(function (R) {
  const { $, toast } = R.util;
  const VISTAS = {
    hoy: { v: () => R.vistaHoy, roles: ["admin", "facturacion", "administracion", "consulta"] },
    planilla: { v: () => R.vistaPlanilla, roles: ["admin", "facturacion", "administracion", "consulta"] },
    despacho: { v: () => R.vistaDespacho, roles: ["admin", "facturacion", "administracion", "consulta"] },
    ajustes: { v: () => R.vistaAjustes, roles: ["admin"] },
  };
  const REFRESCO_MS = 2 * 60 * 1000;   // trae lo que cargaron otras personas
  let vistaActual = null;

  const rol = () => (R.estado.perfil ? R.estado.perfil.fac_rol : null);
  const app = {
    rol,
    esAdmin: () => rol() === "admin",
    puedeCargar: () => ["admin", "facturacion"].includes(rol()),
    puedeCobrar: () => ["admin", "administracion"].includes(rol()),
    // Vuelve a pintar lo que está a la vista (después de un cambio)
    refrescar() {
      if (vistaActual) VISTAS[vistaActual].v().mostrar();
      R.vistaPedido.refrescar();
      app.contadores();
    },
    contadores() {
      if (!R.estado.perfil) return;
      const n = R.vistaHoy.contador(), d = R.vistaDespacho.cantidad();
      $("contador-hoy").textContent = n; $("contador-hoy").hidden = !n;
      $("contador-despacho").textContent = d; $("contador-despacho").hidden = !d;
      document.title = (n ? `(${n}) ` : "") + "Facturación y despacho · Cindy";
    },
  };
  R.app = app;

  function ir() {
    let nombre = location.hash.replace("#", "") || "hoy";
    if (!VISTAS[nombre] || !VISTAS[nombre].roles.includes(rol())) nombre = "hoy";
    vistaActual = nombre;
    document.querySelectorAll("[data-seccion]").forEach(s => { s.hidden = s.id !== "vista-" + nombre; });
    document.querySelectorAll(".lateral a").forEach(a => a.classList.toggle("activo", a.dataset.vista === nombre));
    $("lateral").classList.remove("abierto");
    VISTAS[nombre].v().mostrar();
  }

  function aplicarRol() {
    document.querySelectorAll(".lateral a[data-vista]").forEach(a => { a.hidden = !VISTAS[a.dataset.vista].roles.includes(rol()); });
    R.vistaAcceso.mostrarUsuario({ ...R.estado.perfil, rol: rol() }, rol());
    document.querySelectorAll("[data-solo-carga]").forEach(el => { el.hidden = !app.puedeCargar(); });
  }

  async function entrar() {
    R.vistaAcceso.mostrar("pantalla-carga");
    let perfil;
    try { perfil = await R.api.auth.miPerfil(); }
    catch (e) { R.vistaAcceso.mostrarCindy(); R.vistaAcceso.mostrar("pantalla-login"); return R.vistaAcceso.errorLogin(e.message); }
    const cindy = R.api.auth.via && R.api.auth.via() === "clerk";
    if (!perfil || !perfil.activo || !perfil.fac_rol) {
      // Cuenta Cindy sin acceso acá pero con sesión del login propio: usar esa
      if (cindy && await R.api.auth.sesion({ ignorarClerk: true })) return entrar();
      if (!cindy) await R.api.auth.salir();
      R.vistaAcceso.mostrarCindy();
      R.vistaAcceso.mostrar("pantalla-login");
      return R.vistaAcceso.errorLogin(!perfil || !perfil.activo
        ? (cindy ? "Tu cuenta Cindy todavía no está habilitada en rótulos. Pedile a un admin que la habilite." : "Tu usuario no está habilitado. Hablá con un admin.")
        : "Tu usuario no tiene acceso a Facturación. Pedile a un admin que te lo habilite en Ajustes.");
    }
    R.estado.perfil = perfil;
    try {
      R.estado.catalogo = await R.api.catalogo();
      await R.datos.cargar();
    } catch (e) { R.vistaAcceso.mostrar("pantalla-login"); return R.vistaAcceso.errorLogin(e.message); }
    aplicarRol();
    R.vistaAcceso.mostrar("app");
    ir();
    app.contadores();
  }

  async function entrarConCindy() { if (await R.api.auth.sesion()) await entrar(); }
  function salir() { R.estado = { perfil: null, catalogo: null }; vistaActual = null; R.datos.pedidos = []; R.datos.deshacer.vaciar(); }

  // Trae de nuevo pedidos y listas (botón Actualizar y cada 2 minutos, si no se está editando)
  async function actualizar({ silencioso = false } = {}) {
    if (!R.estado.perfil) return;
    if (silencioso && (R.vistaPlanilla.editando() || document.querySelector("dialog[open]") || document.hidden)) return;
    try {
      const [catalogo] = await Promise.all([R.api.catalogo(), R.datos.cargar()]);
      R.estado.catalogo = catalogo;
      app.refrescar();
      if (!silencioso) toast("Datos actualizados.");
    } catch (e) { if (!silencioso) toast(e.message, "error"); }
  }

  async function arrancar() {
    R.estado = { perfil: null, catalogo: null };
    R.util.iniciarTema();
    if (!R.api.configurado()) return R.vistaAcceso.mostrar("pantalla-config");
    try { R.api.iniciar(); }
    catch (e) { R.vistaAcceso.mostrar("pantalla-login"); return R.vistaAcceso.errorLogin(e.message); }

    R.util.iniciarDialogos();
    R.util.iniciarAyudas();
    R.vistaAcceso.iniciar({ alIngresar: entrar, alIngresarCindy: entrarConCindy, alSalir: salir });
    // El texto de cada opción del menú va en su propio <span> para que, con el menú recogido, queden solo los iconos
    document.querySelectorAll(".lateral a").forEach(l => {
      const texto = [...l.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      if (!texto.length || l.querySelector(".lateral-txt")) return;
      const s = document.createElement("span");
      s.className = "lateral-txt";
      s.textContent = texto.map(n => n.textContent.trim()).join(" ");
      l.title = s.textContent;
      texto.forEach(n => n.remove());
      const svg = l.querySelector("svg");
      (svg ? svg.after(s) : l.prepend(s));
    });
    R.vistaPedido.iniciar();
    Object.values(VISTAS).forEach(x => x.v().iniciar());

    const cfg = window.FAC_CONFIG || {};
    const rotulos = (local && cfg.rotulosUrlLocal) || cfg.rotulosUrl;
    if (rotulos) $("ir-rotulos").href = rotulos; else $("ir-rotulos").hidden = true;
    $("btn-actualizar").addEventListener("click", () => actualizar());
    setInterval(() => actualizar({ silencioso: true }), REFRESCO_MS);
    // Los plazos corren solos: cada minuto se recalcula "qué falta"
    setInterval(() => { if (R.estado.perfil && vistaActual === "hoy" && !document.querySelector("dialog[open]")) app.refrescar(); else app.contadores(); }, 60 * 1000);
    window.addEventListener("hashchange", () => { if (R.estado.perfil) ir(); });
    // Ctrl+Z: deshace lo último (fuera de los campos de texto, donde deshace lo escrito)
    document.addEventListener("keydown", e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      if (!R.estado.perfil) return;
      e.preventDefault();
      R.datos.deshacer.deshacerUltimo();
    });
    try { if (localStorage.getItem("fac-lateral") === "oculto") $("app").classList.add("sin-lateral"); } catch (e) {}
    $("btn-menu").addEventListener("click", () => {
      if (window.matchMedia("(max-width: 900px)").matches) return $("lateral").classList.toggle("abierto");
      const oculto = $("app").classList.toggle("sin-lateral");
      try { localStorage.setItem("fac-lateral", oculto ? "oculto" : "visible"); } catch (e) {}
    });
    document.addEventListener("click", e => {
      if ($("lateral").classList.contains("abierto") && !e.target.closest("#lateral, #btn-menu")) $("lateral").classList.remove("abierto");
    });

    // Cuenta Cindy: si no está configurada o no carga, sigue solo el login propio
    if (window.CuentaCindy) await window.CuentaCindy.cargar((window.FAC_CONFIG || {}).clerkPublishableKey);
    R.vistaAcceso.mostrarCindy();
    R.api.auth.alCambiar(evento => {
      if (evento === "SIGNED_OUT" && (!R.api.auth.via || R.api.auth.via() !== "clerk")) { salir(); R.vistaAcceso.mostrar("pantalla-login"); }
    });
    if (window.CuentaCindy) window.CuentaCindy.alCambiar(({ session }) => {
      R.vistaAcceso.mostrarCindy();
      if (R.api.auth.via && R.api.auth.via() === "clerk" && !session && R.estado.perfil) { salir(); R.vistaAcceso.mostrar("pantalla-login"); }
    });

    if (await R.api.auth.sesion()) await entrar();
    else R.vistaAcceso.mostrar("pantalla-login");
  }

  // Modo de prueba sin base de datos: solo en la PC (abrir con ?demo, ?demo=facturacion | administracion | consulta)
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function cargarDemo() {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "pruebas/api-falsa.js?v=" + Date.now();
      s.onload = ok; s.onerror = () => mal(new Error("No se encontró pruebas/api-falsa.js"));
      document.head.appendChild(s);
    });
  }

  (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => (local && /[?&]demo\b/.test(location.search) ? cargarDemo() : null))
    .then(arrancar)
    .catch(e => { R.vistaAcceso.mostrar("pantalla-login"); R.vistaAcceso.errorLogin(e.message); });
})(window.FAC);
