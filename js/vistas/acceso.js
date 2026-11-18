// =====================================================================
//  Vista: pantallas de acceso (falta configurar / login / cargando) y
//  barra del usuario logueado.
// =====================================================================
(function (R) {
  const { $ } = R.util;
  const PANTALLAS = ["pantalla-config", "pantalla-carga", "pantalla-login", "pantalla-sucursal", "app"];
  const ROLES = { admin: "Admin", facturacion: "Facturación", administracion: "Administración", consulta: "Consulta" };

  function mostrar(id) { PANTALLAS.forEach(p => { $(p).hidden = p !== id; }); }

  // rol: el rol con el que se ve la página (el del perfil, o el de prueba si el admin eligió "Ver como")
  function mostrarUsuario(perfil, rol = perfil.rol) {
    const esAdmin = rol === "admin";
    $("usuario-nombre").textContent = perfil.nombre || R.util.aUsuario(perfil.email);
    $("usuario-rol").textContent = (ROLES[rol] || rol) + (rol !== perfil.rol ? " (prueba)" : "");
    $("usuario-rol").classList.toggle("admin", esAdmin);
    document.querySelectorAll("[data-solo-admin]").forEach(el => { el.hidden = !esAdmin; });
    $("usuario-via").hidden = perfil.via !== "clerk";
    $("salir").title = perfil.via === "clerk" ? "Cierra la cuenta Cindy en todas las apps" : "";
  }

  // Muestra u oculta el botón de cuenta Cindy según si Clerk cargó
  const CC = () => window.CuentaCindy;
  function mostrarCindy() {
    const hay = !!(CC() && CC().hayClerk());
    $("login-cindy").hidden = !hay;
    $("form-login").classList.toggle("con-cindy", hay);
    $("salir-cindy").hidden = !(hay && CC().conSesion());
  }

  function errorLogin(mensaje) { $("login-error").textContent = mensaje || ""; }

  function iniciar({ alIngresar, alIngresarCindy, alSalir }) {
    $("login-clerk").addEventListener("click", () => {
      errorLogin("");
      if (CC().conSesion()) alIngresarCindy(); // ya hay sesión (por ej. de otra app)
      else CC().abrirIngreso();
    });
    $("salir-cindy").addEventListener("click", async () => {
      await CC().salir();
      errorLogin("");
      mostrarCindy();
    });
    $("form-login").addEventListener("submit", async e => {
      e.preventDefault();
      errorLogin("");
      $("login-btn").disabled = true;
      try {
        await R.api.auth.ingresar($("login-email").value, $("login-password").value);
        $("login-password").value = "";
        await alIngresar();
      } catch (err) {
        errorLogin(err.message);
      } finally { $("login-btn").disabled = false; }
    });
    $("salir").addEventListener("click", async () => {
      const cindy = R.api.auth.via && R.api.auth.via() === "clerk";
      if (cindy && (await R.util.pedir({ titulo: "Salir", texto: "Se va a cerrar tu cuenta Cindy en todas las apps (Panel, rótulos, RRHH y las demás). ¿Continuar?", boton: "Salir" })) == null) return;
      await R.api.auth.salir({ cuentaCindy: cindy });
      alSalir();
      mostrarCindy();
      mostrar("pantalla-login");
    });
  }

  R.vistaAcceso = { iniciar, mostrar, mostrarUsuario, errorLogin, mostrarCindy };
})(window.FAC);
