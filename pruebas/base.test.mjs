// Pruebas de la base: corre las migraciones de rótulos (la base es la misma) y después
// las de facturación en un Postgres en memoria (PGlite), con un esquema "auth" mínimo
// que imita a Supabase. Prueba el circuito de estados y los permisos de cada rol.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROTULOS = path.join(RAIZ, '..', 'impresion de rotulos', 'supabase', 'migrations');
const PROPIAS = path.join(RAIZ, 'supabase', 'migrations');
const leer = dir => fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort().map(n => ({ n, sql: fs.readFileSync(path.join(dir, n), 'utf8') }));
const hayRotulos = fs.existsSync(ROTULOS);

const U = {
  luca: '00000000-0000-0000-0000-00000000000a',      // superadmin de rótulos = admin acá
  greisy: '00000000-0000-0000-0000-00000000000b',    // facturacion
  guada: '00000000-0000-0000-0000-00000000000c',     // facturacion
  anto: '00000000-0000-0000-0000-00000000000d',      // administracion
  mirar: '00000000-0000-0000-0000-00000000000e',     // consulta
  operador: '00000000-0000-0000-0000-00000000000f',  // usa rótulos, sin acceso a facturación
  baja: '00000000-0000-0000-0000-000000000010',      // facturacion, pero perfil desactivado
};
const CLERK = 'user_2abcClerkGreisy';
let db;

before(async () => {
  if (!hayRotulos) return;
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        || case when nullif(current_setting('request.jwt.claim.sub', true), '') is not null
                then jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'iss', 'https://x.supabase.co/auth/v1')
                else '{}'::jsonb end $$;
    grant execute on function auth.jwt() to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  for (const { sql } of [...leer(ROTULOS), ...leer(PROPIAS)]) await db.exec(sql);
  for (const [nombre, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
      [id, `${nombre}@rotulos.cindymayorista.com.ar`, { nombre: nombre[0].toUpperCase() + nombre.slice(1) }]);
  }
  await db.exec(`
    update public.perfiles set activo = true where id <> '${U.baja}';
    update public.perfiles set rol = 'superadmin' where id = '${U.luca}';
    insert into public.fac_usuarios (perfil_id, rol) values
      ('${U.greisy}', 'facturacion'), ('${U.guada}', 'facturacion'), ('${U.anto}', 'administracion'),
      ('${U.mirar}', 'consulta'), ('${U.baja}', 'facturacion');
    -- Cuenta Cindy (Clerk) de Greisy vinculada a su perfil
    update public.perfiles set clerk_id = '${CLERK}' where id = '${U.greisy}';
    insert into public.clientes (nombre, tel, transporte) values ('FARMACIA ROCA', '353 4123456', 'VIA CARGO');
  `);
});

// Corre una consulta como un usuario del login propio (o sin sesión, con usuario = null).
// Si falla, se deshace, igual que un pedido a Supabase.
async function como(usuario, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(usuario ? `set local role authenticated; set local request.jwt.claim.sub = '${usuario}';` : 'set local role anon;');
    return (await tx.query(sql, params)).rows;
  });
}
// Igual, con un token de Clerk (cuenta Cindy)
async function comoClerk(sub, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ sub, iss: 'https://nice-arachnid-8864.clerk.accounts.dev' })}';`);
    return (await tx.query(sql, params)).rows;
  });
}
const alta = (usuario, p) => como(usuario,
  `insert into public.fac_pedidos (cliente, numero, transporte, facturo, importe_1, importe_2, fecha)
   values ($1, $2, $3, $4, $5, $6, coalesce($7::date, (now() at time zone 'America/Argentina/Cordoba')::date)) returning *`,
  [p.cliente ?? 'CLIENTE', p.numero ?? '', p.transporte ?? 'VIA CARGO', p.facturo ?? 'Greisy', p.importe_1 ?? 100000, p.importe_2 ?? null, p.fecha ?? null])
  .then(f => f[0]);
const accion = (usuario, id, a, p = {}) => como(usuario, 'select * from public.fac_accion($1, $2, $3)', [id, a, p]).then(f => f[0]);
const fila = async id => (await db.query('select * from public.fac_pedidos where id = $1', [id])).rows[0];
const ayer = () => { const d = new Date(Date.now() - 86400000 - 3 * 3600000); return d.toISOString().slice(0, 10); };
const t = hayRotulos ? test : test.skip;

t('sin sesión no se ve nada', async () => {
  await assert.rejects(como(null, 'select * from public.fac_pedidos'), /permission denied/);
  await assert.rejects(como(null, 'select public.fac_rol()'), /permission denied/);
});

t('rol de cada persona', async () => {
  const rol = async u => (await como(u, 'select public.fac_rol() as r'))[0].r;
  assert.equal(await rol(U.luca), 'admin');
  assert.equal(await rol(U.greisy), 'facturacion');
  assert.equal(await rol(U.anto), 'administracion');
  assert.equal(await rol(U.mirar), 'consulta');
  assert.equal(await rol(U.operador), null, 'un usuario de rótulos sin rol no entra a facturación');
  assert.equal(await rol(U.baja), null, 'perfil desactivado');
  assert.equal((await comoClerk(CLERK, 'select public.fac_rol() as r'))[0].r, 'facturacion', 'cuenta Cindy vinculada');
});

t('quien no tiene acceso no ve ni carga pedidos', async () => {
  await alta(U.greisy, { cliente: 'VISIBLE PARA TODOS' });
  assert.equal((await como(U.operador, 'select * from public.fac_pedidos')).length, 0);
  await assert.rejects(alta(U.operador, { cliente: 'X' }), /row-level security/);
  await assert.rejects(alta(U.mirar, { cliente: 'X' }), /row-level security/, 'consulta solo mira');
  await assert.rejects(alta(U.anto, { cliente: 'X' }), /row-level security/, 'administración no carga pedidos');
  assert.ok((await como(U.mirar, 'select * from public.fac_pedidos')).length > 0);
});

t('alta: limpia los textos, calcula el total y controla la fecha', async () => {
  const p = await alta(U.greisy, { cliente: '  PARRA   AGOSTINA ', importe_1: 171416.45, importe_2: 98993 });
  assert.equal(p.cliente, 'PARRA AGOSTINA');
  assert.equal(Number(p.total), 270409.45);
  assert.equal(p.estado, 'facturado');
  assert.ok(p.creado_por, 'queda quién lo cargó');
  await assert.rejects(alta(U.greisy, { fecha: '2099-01-01' }), /posterior a hoy/);
  await assert.rejects(alta(U.greisy, { importe_1: -5 }), /check/);
  await assert.rejects(alta(U.greisy, { cliente: '   ' }), /check/);
});

t('el estado no se toca a mano, solo con las acciones', async () => {
  const p = await alta(U.greisy, {});
  await assert.rejects(como(U.greisy, `update public.fac_pedidos set estado = 'despachado' where id = $1`, [p.id]), /permission denied/);
  await assert.rejects(como(U.greisy, `update public.fac_pedidos set pago_confirmado_en = now() where id = $1`, [p.id]), /permission denied/);
  await assert.rejects(como(U.greisy, `insert into public.fac_pedidos (cliente, estado) values ('X', 'listo')`), /permission denied/);
  await assert.rejects(como(U.greisy, `update public.fac_pedidos set despacho_fecha = current_date where id = $1`, [p.id]), /al marcar el pedido como despachado/);
  // Los datos sí se corrigen
  const [c] = await como(U.greisy, `update public.fac_pedidos set importe_2 = 5000, transporte = 'CREDIFIN' where id = $1 returning total`, [p.id]);
  assert.equal(Number(c.total), 105000);
});

t('circuito completo: T1, T2, pago informado, confirmado, despachado', async () => {
  const p = await alta(U.greisy, { cliente: 'FERRERO MARIA EUGENIA', fecha: ayer() });
  let r = await accion(U.greisy, p.id, 't1');
  assert.equal(r.estado, 'esperando_pago');
  assert.ok(r.t1_en);
  await assert.rejects(accion(U.greisy, p.id, 't1'), /recién facturado/);
  r = await accion(U.guada, p.id, 't2');
  assert.ok(r.t2_en);
  r = await accion(U.greisy, p.id, 'informar_pago');
  assert.equal(r.estado, 'pago_informado');
  await assert.rejects(accion(U.greisy, p.id, 'confirmar_pago'), /No tenés permiso/, 'facturación no confirma pagos');
  await assert.rejects(accion(U.mirar, p.id, 'confirmar_pago'), /No tenés permiso/);
  r = await accion(U.anto, p.id, 'confirmar_pago');
  assert.equal(r.estado, 'listo');
  assert.equal(r.pago_confirmado_por, (await db.query('select id from public.perfiles where auth_id = $1', [U.anto])).rows[0].id);
  await assert.rejects(accion(U.anto, p.id, 'despachar'), /No tenés permiso/, 'administración no despacha');
  await assert.rejects(accion(U.greisy, p.id, 'despachar', { fecha: '2020-05-16' }), /anterior a la del pedido/);
  await assert.rejects(accion(U.greisy, p.id, 'despachar', { fecha: '2099-01-01' }), /posterior a hoy/);
  r = await accion(U.greisy, p.id, 'despachar', { guia: ' 3600-12345678 ' });
  assert.equal(r.estado, 'despachado');
  assert.equal(r.guia, '3600-12345678');
  assert.ok(r.despacho_fecha && r.despachado_por);
});

t('deshacer: cada paso vuelve al anterior', async () => {
  const p = await alta(U.greisy, {});
  await accion(U.greisy, p.id, 't1');
  await accion(U.greisy, p.id, 't2');
  let r = await accion(U.greisy, p.id, 'volver');
  assert.equal(r.estado, 'esperando_pago'); assert.equal(r.t2_en, null);
  await accion(U.greisy, p.id, 'informar_pago');
  await accion(U.anto, p.id, 'confirmar_pago');
  await assert.rejects(accion(U.greisy, p.id, 'volver'), /No tenés permiso/, 'el pago confirmado lo deshace administración');
  await accion(U.greisy, p.id, 'despachar', {});
  r = await accion(U.greisy, p.id, 'volver');
  assert.equal(r.estado, 'listo'); assert.equal(r.despacho_fecha, null);
  r = await accion(U.anto, p.id, 'volver');
  assert.equal(r.estado, 'pago_informado'); assert.equal(r.pago_confirmado_por, null);
  r = await accion(U.greisy, p.id, 'volver');
  assert.equal(r.estado, 'esperando_pago');
  r = await accion(U.greisy, p.id, 'volver');
  assert.equal(r.estado, 'facturado'); assert.equal(r.t1_en, null);
  await assert.rejects(accion(U.greisy, p.id, 'volver'), /ningún paso/);
});

t('rechazar un pago informado vuelve a esperar', async () => {
  const p = await alta(U.greisy, {});
  await accion(U.greisy, p.id, 't1');
  await accion(U.greisy, p.id, 'informar_pago');
  const r = await accion(U.anto, p.id, 'rechazar_pago');
  assert.equal(r.estado, 'esperando_pago');
  assert.equal(r.pago_informado_en, null);
});

t('baja con nota de crédito, y se puede deshacer', async () => {
  const p = await alta(U.greisy, {});
  await accion(U.greisy, p.id, 't1');
  await accion(U.greisy, p.id, 't2');
  let r = await accion(U.greisy, p.id, 'baja', { nota_credito: 'NC 0003-00001234', motivo: 'Sin respuesta' });
  assert.equal(r.estado, 'baja'); assert.equal(r.nota_credito, 'NC 0003-00001234'); assert.ok(r.t3_en);
  await assert.rejects(accion(U.greisy, p.id, 'despachar'), /pago confirmado/);
  r = await accion(U.greisy, p.id, 'volver');
  assert.equal(r.estado, 'esperando_pago'); assert.equal(r.t3_en, null);
  // Un pedido ya pagado no se da de baja
  await accion(U.anto, p.id, 'confirmar_pago');
  await assert.rejects(accion(U.greisy, p.id, 'baja'), /sin pago confirmado/);
});

t('despachar sin pago: solo el admin (excepción)', async () => {
  const p = await alta(U.greisy, {});
  await assert.rejects(accion(U.greisy, p.id, 'despachar'), /pago confirmado/);
  const r = await accion(U.luca, p.id, 'despachar', { remito_firmado: true });
  assert.equal(r.estado, 'despachado'); assert.equal(r.remito_firmado, true);
  assert.equal((await accion(U.luca, p.id, 'volver')).estado, 'facturado');
});

t('cuenta Cindy: carga y cambia estados como su perfil', async () => {
  const [p] = await comoClerk(CLERK, `insert into public.fac_pedidos (cliente, importe_1) values ('DESDE CLERK', 1000) returning *`);
  const greisy = (await db.query('select id from public.perfiles where auth_id = $1', [U.greisy])).rows[0].id;
  assert.equal(p.creado_por, greisy);
  const [r] = await comoClerk(CLERK, 'select * from public.fac_accion($1, $2)', [p.id, 't1']);
  assert.equal(r.estado, 'esperando_pago');
});

t('historial: queda cada cambio con quién lo hizo', async () => {
  const p = await alta(U.greisy, { cliente: 'CON HISTORIAL' });
  await como(U.guada, `update public.fac_pedidos set observaciones = 'llamar a la tarde' where id = $1`, [p.id]);
  await accion(U.greisy, p.id, 't1');
  const h = await como(U.mirar, 'select accion, cambios, por from public.fac_historial where pedido_id = $1 order by id', [p.id]);
  assert.deepEqual(h.map(x => x.accion), ['alta', 'cambio', 'cambio']);
  assert.deepEqual(h[1].cambios.observaciones, ['', 'llamar a la tarde']);
  assert.ok(h[2].cambios.estado && h[2].cambios.t1_en);
  const guada = (await db.query('select id from public.perfiles where auth_id = $1', [U.guada])).rows[0].id;
  assert.equal(h[1].por, guada);
  await assert.rejects(como(U.greisy, `delete from public.fac_historial where pedido_id = $1`, [p.id]), /permission denied/);
});

t('borrar: el que cargó dentro de 2 horas, o el admin', async () => {
  const p = await alta(U.greisy, {});
  assert.equal((await como(U.guada, 'delete from public.fac_pedidos where id = $1 returning id', [p.id])).length, 0, 'otra persona no lo borra');
  assert.equal((await como(U.greisy, 'delete from public.fac_pedidos where id = $1 returning id', [p.id])).length, 1);
  const q = await alta(U.greisy, {});
  await db.query(`update public.fac_pedidos set creado_en = now() - interval '3 hours' where id = $1`, [q.id]);
  assert.equal((await como(U.greisy, 'delete from public.fac_pedidos where id = $1 returning id', [q.id])).length, 0, 'pasadas las 2 horas');
  assert.equal((await como(U.luca, 'delete from public.fac_pedidos where id = $1 returning id', [q.id])).length, 1);
});

t('personas: nombres solo para quien tiene acceso; el admin ve a todos para asignar roles', async () => {
  const admin = await como(U.luca, 'select * from public.fac_personas()');
  assert.ok(admin.some(x => x.email.startsWith('operador@')), 'el admin ve también a quien todavía no tiene rol');
  const greisy = await como(U.greisy, 'select * from public.fac_personas()');
  assert.ok(greisy.length >= 5 && !greisy.some(x => x.email.startsWith('operador@')));
  assert.equal((await como(U.operador, 'select * from public.fac_personas()')).length, 0);
});

t('ajustes, listas y usuarios: solo el admin los cambia', async () => {
  await assert.rejects(como(U.greisy, `update public.fac_ajustes set valor = '72' where clave = 'horas_t2' returning clave`)
    .then(f => { if (!f.length) throw new Error('row-level security'); }), /row-level security/);
  assert.equal((await como(U.luca, `update public.fac_ajustes set valor = '48' where clave = 'horas_t2' returning clave`)).length, 1);
  await assert.rejects(como(U.greisy, `insert into public.fac_opciones (tipo, valor) values ('armador', 'Nuevo')`), /row-level security/);
  await como(U.luca, `insert into public.fac_opciones (tipo, valor) values ('armador', 'Lolo')`);
  const operador = (await db.query('select id from public.perfiles where auth_id = $1', [U.operador])).rows[0].id;
  await assert.rejects(como(U.greisy, `insert into public.fac_usuarios (perfil_id, rol) values ($1, 'facturacion')`, [operador]), /row-level security/);
  await como(U.luca, `insert into public.fac_usuarios (perfil_id, rol) values ($1, 'consulta')`, [operador]);
  assert.equal((await como(U.operador, 'select public.fac_rol() as r'))[0].r, 'consulta', 'el admin le da acceso');
  await como(U.luca, `delete from public.fac_usuarios where perfil_id = $1`, [operador]);
  const ops = await como(U.greisy, `select valor from public.fac_opciones where tipo = 'facturo' order by orden`);
  assert.deepEqual(ops.map(o => o.valor), ['Greisy', 'Guada']);
});

t('no toca rótulos: un operador sigue viendo clientes y transportes', async () => {
  assert.ok((await como(U.operador, 'select * from public.clientes')).length >= 1);
  assert.ok((await como(U.operador, 'select * from public.transportes')).length >= 10);
  assert.equal((await como(U.operador, `select public.es_superadmin() as s`))[0].s, false);
});

t('se puede correr dos veces', async () => {
  for (const { sql } of leer(PROPIAS)) await db.exec(sql);
  assert.equal((await db.query(`select count(*)::int as n from public.fac_opciones where tipo = 'facturo'`)).rows[0].n, 2);
});
