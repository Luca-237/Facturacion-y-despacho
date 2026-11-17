// =====================================================================
//  Única capa de datos: todo lo que habla con Supabase pasa por acá.
//  Las vistas nunca llaman a Supabase directo.
//  (Para probar sin base: pruebas/api-falsa.js reemplaza este objeto.)
// =====================================================================
(function (R) {
  // Dos conexiones a la misma base, una por tipo de login:
  //   sbPropio -> usuario y contraseña (los mismos de rótulos, Auth de Supabase)
  //   sbClerk  -> cuenta Cindy (token de Clerk; ahí supabase.auth no se usa)
  let sbPropio = null, sbClerk = null, sb = null;
  let via = null; // "clerk" | "propio" | null

  function configurado() {
    const c = window.FAC_CONFIG || {};
    return /^https:\/\/\S+$/.test(c.supabaseUrl || "") && (c.supabaseKey || "").length > 20;
  }

  function iniciar() {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("No se pudo cargar la librería de Supabase. Revisá la conexión a internet.");
    }
    const c = window.FAC_CONFIG;
    const url = c.supabaseUrl.replace(/\/+$/, "");
    sbPropio = window.supabase.createClient(url, c.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "fac.sesion" },
    });
    sbClerk = window.supabase.createClient(url, c.supabaseKey, { accessToken: () => window.CuentaCindy.token() });
    sb = sbPropio;
  }

  function usar(v) { via = v; sb = v === "clerk" ? sbClerk : sbPropio; }

  // Errores de Supabase -> mensajes para la persona (los de la base ya vienen en castellano)
  function mensaje(error) {
    const m = (error && (error.message || error.error_description)) || String(error);
    if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
    if (/banned/i.test(m)) return "Tu usuario está desactivado. Hablá con un admin.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No hay conexión con la base de datos. Revisá internet.";
    if (/row-level security|permission denied/i.test(m)) return "No tenés permiso para hacer esto.";
    if (/JWT expired/i.test(m)) return "La sesión venció. Volvé a ingresar.";
    if (/No suitable key|wrong key type/i.test(m)) return "La base todavía no acepta la cuenta Cindy. Entrá con tu usuario.";
    if (/fac_opciones_unico|duplicate key.*fac_opciones/i.test(m)) return "Esa opción ya existe en la lista.";
    if (/fac_pedidos_cliente_check/i.test(m)) return "Falta el cliente.";
    if (/importe_[12]_check/i.test(m)) return "El importe no puede ser negativo.";
    if (/Could not find the function public\.fac_|relation "public\.fac_|PGRST202|PGRST205/i.test(m)) return "Falta instalar Facturación en la base (migración 20261117500000_facturacion.sql).";
    return m;
  }
  function chequear({ data, error }) {
    if (error) throw new Error(mensaje(error));
    return data;
  }
  // Trae todas las filas (Supabase devuelve de a 1000)
  async function todo(consulta) {
    const filas = [], LOTE = 1000;
    for (let desde = 0; ; desde += LOTE) {
      const lote = chequear(await consulta().range(desde, desde + LOTE - 1));
      filas.push(...lote);
      if (lote.length < LOTE) return filas;
    }
  }
  const NUMEROS = ["importe_1", "importe_2", "total"];
  const numeros = f => { NUMEROS.forEach(k => { if (f[k] != null) f[k] = Number(f[k]); }); return f; };

  // ---------- Sesión ----------
  const auth = {
    via: () => via,
    async ingresar(usuario, password) {
      chequear(await sbPropio.auth.signInWithPassword({ email: R.util.aEmail(usuario), password }));
      usar("propio");
    },
    // La cuenta Cindy se cierra solo si se pide, porque es la misma sesión en todas las apps.
    async salir({ cuentaCindy = false } = {}) {
      await sbPropio.auth.signOut();
      if (cuentaCindy) await window.CuentaCindy.salir();
      usar(null);
    },
    async sesion({ ignorarClerk = false } = {}) {
      if (!ignorarClerk && window.CuentaCindy.conSesion()) { usar("clerk"); return true; }
      const { data } = await sbPropio.auth.getSession();
      if (data.session) { usar("propio"); return true; }
      usar(null);
      return false;
    },
    alCambiar(cb) { sbPropio.auth.onAuthStateChange((evento, sesion) => cb(evento, sesion)); },
    // Perfil de rótulos (mi_perfil vincula la cuenta Cindy la primera vez) + rol en facturación
    async miPerfil() {
      if (!via) return null;
      const filas = chequear(await sb.rpc("mi_perfil"));
      const p = (filas && filas[0]) || null;
      if (!p || !p.activo) return p;
      p.fac_rol = chequear(await sb.rpc("fac_rol")) || null;
      return p;
    },
  };

  // ---------- Listas, ajustes y personas ----------
  async function catalogo() {
    const [opciones, transportes, ajustes, personas] = await Promise.all([
      sb.from("fac_opciones").select("*").order("orden").order("valor").then(chequear),
      sb.from("transportes").select("id, nombre, orden, activo").order("orden").order("nombre").then(chequear),
      sb.from("fac_ajustes").select("clave, valor").then(chequear),
      sb.rpc("fac_personas").then(chequear),
    ]);
    return {
      opciones, transportes,
      ajustes: Object.fromEntries(ajustes.map(a => [a.clave, a.valor])),
      personas,
    };
  }

  // ---------- Pedidos ----------
  const pedidos = {
    async todos() {
      return (await todo(() => sb.from("fac_pedidos").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }))).map(numeros);
    },
    async uno(id) { return numeros(chequear(await sb.from("fac_pedidos").select("*").eq("id", id).single())); },
    async crear(datos) { return numeros(chequear(await sb.from("fac_pedidos").insert(datos).select().single())); },
    async actualizar(id, cambios) { return numeros(chequear(await sb.from("fac_pedidos").update(cambios).eq("id", id).select().single())); },
    async borrar(id) {
      const filas = chequear(await sb.from("fac_pedidos").delete().eq("id", id).select("id"));
      if (!filas.length) throw new Error("No se pudo borrar: solo el admin, o quien lo cargó dentro de las 2 horas.");
    },
    // t1, t2, informar_pago, confirmar_pago, rechazar_pago, despachar, baja, volver
    async accion(id, accion, datos = {}) { return numeros(chequear(await sb.rpc("fac_accion", { p_id: id, p_accion: accion, p: datos }))); },
    async historial(id) { return chequear(await sb.from("fac_historial").select("*").eq("pedido_id", id).order("en", { ascending: false }).order("id", { ascending: false })); },
  };

  // ---------- Clientes de rótulos (para autocompletar) ----------
  const clientes = {
    async buscar(q) {
      q = String(q || "").trim();
      if (q.length < 2) return [];
      const patron = "%" + q.replace(/[%_,()]/g, " ").trim().replace(/\s+/g, "%") + "%";
      return chequear(await sb.from("clientes").select("id, nombre, tel, transporte, ciudad, provincia")
        .ilike("nombre", patron).order("nombre").limit(8));
    },
  };

  // ---------- Administración (solo admin) ----------
  const admin = {
    async guardarOpcion(o) {
      const datos = { valor: o.valor, orden: o.orden ?? 100, activo: o.activo ?? true };
      if (o.id) return chequear(await sb.from("fac_opciones").update(datos).eq("id", o.id).select().single());
      return chequear(await sb.from("fac_opciones").insert({ ...datos, tipo: o.tipo }).select().single());
    },
    async guardarAjuste(clave, valor) {
      return chequear(await sb.from("fac_ajustes").update({ valor }).eq("clave", clave).select().single());
    },
    // rol: "facturacion" | "administracion" | "consulta" | null (quitar el acceso)
    async asignarRol(perfilId, rol) {
      if (!rol) { chequear(await sb.from("fac_usuarios").delete().eq("perfil_id", perfilId)); return; }
      chequear(await sb.from("fac_usuarios").upsert({ perfil_id: perfilId, rol, activo: true }, { onConflict: "perfil_id" }));
    },
  };

  R.api = { configurado, iniciar, auth, catalogo, pedidos, clientes, admin };
})(window.FAC);
