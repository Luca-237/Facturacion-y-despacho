// =====================================================================
//  Conexión con Supabase. Es la MISMA base que el generador de rótulos
//  (comparte usuarios, clientes y transportes). Estos valores son PÚBLICOS
//  (van en el navegador de todos modos): lo que protege los datos son los
//  permisos de la base (RLS). La clave "secret" NUNCA va acá.
// =====================================================================
window.FAC_CONFIG = {
  supabaseUrl: "https://snnuxfdwjjqxdnhwouta.supabase.co",   // proyecto de rótulos
  supabaseKey: "sb_publishable_6zmE4xyY8MOyTyC1se0u6w_GhjDVSEv",   // clave "publishable" (la misma de rótulos)
  // Mismos usuarios que rótulos: "greisy" -> "greisy@rotulos.cindymayorista.com.ar"
  dominioUsuarios: "rotulos.cindymayorista.com.ar",
  // Pestaña para volver al generador de rótulos
  rotulosUrl: "https://rotulos.bagsstore.com.ar",
  rotulosUrlLocal: "http://localhost:5560",
  // Cuenta Cindy (Clerk). Clave publicable (pk_live_... o pk_test_...), no es secreta.
  // Vacía = solo el login propio.
  clerkPublishableKey: "pk_test_bmljZS1hcmFjaG5pZC04ODY0LmNsZXJrLmFjY291bnRzLmRldiQ",
};
