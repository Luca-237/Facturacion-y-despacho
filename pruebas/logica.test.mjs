// Pruebas de los plazos hábiles (js/plazos.js) y de los mensajes armados (js/mensajes.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/plazos.js');
const M = require('../js/mensajes.js');

// Fechas en hora argentina
const ar = s => new Date(s + '-03:00');

test('horas hábiles: sin domingos', () => {
  // Viernes 13/11/2026 10:00 -> lunes 16/11 10:00: cuenta el viernes (14 h) + sábado (24 h) + lunes (10 h)
  assert.equal(P.horasHabiles(ar('2026-11-13T10:00:00'), ar('2026-11-16T10:00:00')), 48);
  // Dentro del mismo día
  assert.equal(P.horasHabiles(ar('2026-11-17T09:00:00'), ar('2026-11-17T15:30:00')), 6.5);
  // Domingo entero no cuenta
  assert.equal(P.horasHabiles(ar('2026-11-15T08:00:00'), ar('2026-11-15T20:00:00')), 0);
  // Al revés da 0
  assert.equal(P.horasHabiles(ar('2026-11-17T15:00:00'), ar('2026-11-17T09:00:00')), 0);
});

test('horas hábiles: feriados de Ajustes', () => {
  const aj = { feriados: ['2026-11-16'] };
  assert.equal(P.horasHabiles(ar('2026-11-13T10:00:00'), ar('2026-11-17T10:00:00'), aj), 48);
});

test('vencimiento del T2 (48 h hábiles)', () => {
  // T1 viernes 10:00 -> vence lunes 10:00 (el domingo no cuenta)
  assert.equal(P.vencimiento(ar('2026-11-13T10:00:00'), 48).toISOString(), ar('2026-11-16T10:00:00').toISOString());
  // T1 martes 18:00 -> jueves 18:00
  assert.equal(P.vencimiento(ar('2026-11-17T18:00:00'), 48).toISOString(), ar('2026-11-19T18:00:00').toISOString());
  // T1 sábado 12:00 -> 12 h del sábado + 36 h desde el lunes -> martes 12:00
  assert.equal(P.vencimiento(ar('2026-11-14T12:00:00'), 48).toISOString(), ar('2026-11-17T12:00:00').toISOString());
});

test('qué falta en cada estado', () => {
  const ahora = ar('2026-11-17T11:00:00');
  assert.equal(P.pendiente({ estado: 'facturado', creado_en: ar('2026-11-17T10:30:00') }, {}, ahora).clave, 't1');
  assert.equal(P.pendiente({ estado: 'facturado', creado_en: ar('2026-11-16T10:00:00') }, {}, ahora).urgente, true);
  // T1 hace 20 h: todavía espera
  let r = P.pendiente({ estado: 'esperando_pago', t1_en: ar('2026-11-16T15:00:00') }, {}, ahora);
  assert.equal(r.clave, 'esperar'); assert.equal(r.urgente, false); assert.match(r.detalle, /T2 en 1 día y 4 h/);
  // T1 el viernes 10:00: el lunes 10:00 se cumplieron las 48 h hábiles -> T2
  r = P.pendiente({ estado: 'esperando_pago', t1_en: ar('2026-11-13T10:00:00') }, {}, ahora);
  assert.equal(r.clave, 't2'); assert.equal(r.urgente, true);
  // T2 hace 25 h -> baja
  assert.equal(P.pendiente({ estado: 'esperando_pago', t1_en: ar('2026-11-12T10:00:00'), t2_en: ar('2026-11-16T10:00:00') }, {}, ahora).clave, 'baja');
  // T2 hace 2 h -> espera respuesta
  assert.equal(P.pendiente({ estado: 'esperando_pago', t1_en: ar('2026-11-12T10:00:00'), t2_en: ar('2026-11-17T09:00:00') }, {}, ahora).clave, 'esperar_t2');
  // Plazos cambiados en Ajustes
  assert.equal(P.pendiente({ estado: 'esperando_pago', t1_en: ar('2026-11-16T15:00:00') }, { horas_t2: 12 }, ahora).clave, 't2');
  assert.equal(P.pendiente({ estado: 'pago_informado', pago_informado_en: ar('2026-11-17T10:00:00') }, {}, ahora).quien, 'administracion');
  assert.equal(P.pendiente({ estado: 'listo' }, {}, ahora).clave, 'despachar');
  assert.equal(P.pendiente({ estado: 'despachado' }, {}, ahora), null);
  assert.equal(P.pendiente({ estado: 'baja', nota_credito: '' }, {}, ahora).clave, 'nc');
  assert.equal(P.pendiente({ estado: 'baja', nota_credito: 'NC 1' }, {}, ahora), null);
});

test('próxima ventana de despacho', () => {
  assert.deepEqual(P.proximaVentana({}, ar('2026-11-17T08:00:00')), { hora: '10:00', dia: 'hoy' });
  assert.deepEqual(P.proximaVentana({}, ar('2026-11-17T11:00:00')), { hora: '15:00', dia: 'hoy' });
  assert.deepEqual(P.proximaVentana({}, ar('2026-11-17T16:00:00')), { hora: '10:00', dia: 'mañana' });
  // Sábado a la tarde -> lunes (el domingo no es hábil)
  assert.deepEqual(P.proximaVentana({}, ar('2026-11-14T16:00:00')), { hora: '10:00', dia: '2026-11-16' });
});

test('importe en una o dos partes', () => {
  assert.equal(M.importeTexto({ importe_1: 171416.45 }), '$ 171.416,45');
  assert.equal(M.importeTexto({ importe_1: 171416.45, importe_2: 98993 }), '$ 171.416,45 (parte 1) + $ 98.993 (parte 2), total $ 270.409,45');
  assert.equal(M.pesos(1626611), '$ 1.626.611');
});

test('nombre para el saludo', () => {
  assert.equal(M.nombreSaludo('PARRA AGOSTINA'), 'Parra Agostina');
  assert.equal(M.nombreSaludo("D'ANGELO NICOLAS MIGUEL"), "D'Angelo Nicolas Miguel");
  assert.equal(M.nombreSaludo('FABRICA DE MUEBLES GREGORIS'), 'Fabrica de Muebles Gregoris');
});

test('T1 con todos los datos, en los tres tonos', () => {
  const d = M.datosDe({ cliente: 'PARRA AGOSTINA', importe_1: 1000, importe_2: 500, alias_pago: 'cindy.mayorista.gal', transporte: 'VIA CARGO', faltantes: '2 billeteras ref. 205' });
  for (const tono of Object.keys(M.TONOS)) {
    const m = M.t1(d, tono, ar('2026-11-17T10:00:00'));
    assert.match(m, /Parra Agostina/);
    assert.match(m, /\$ 1\.000 \(parte 1\) \+ \$ 500 \(parte 2\), total \$ 1\.500/);
    assert.match(m, /cindy\.mayorista\.gal/);
    assert.match(m, /VIA CARGO/);
    assert.match(m, /2 billeteras ref\. 205/);
    assert.doesNotMatch(m, /undefined|null|\*\*/);
  }
  assert.match(M.t1(d, 'formal', ar('2026-11-17T10:00:00')), /^Buen día/);
  assert.match(M.t1(d, 'formal', ar('2026-11-17T16:00:00')), /^Buenas tardes/);
});

test('T1 según el transporte', () => {
  const base = { cliente: 'X', importe_1: 1, alias_pago: 'a' };
  assert.match(M.t1(M.datosDe({ ...base, transporte: 'RETIRA EN LOCAL' })), /retirar por el local/);
  assert.match(M.t1(M.datosDe({ ...base, transporte: 'COMISIONISTA' })), /comisionista \(firma el remito/);
  assert.doesNotMatch(M.t1(M.datosDe({ ...base, transporte: '' })), /envío/);
});

test('T2 y T3', () => {
  const d = M.datosDe({ cliente: 'CASTRO MARIA LAURA', importe_1: 169880.16, alias_pago: 'cindy.mayorista.gal', nota_credito: 'NC 0003-00001234' });
  assert.match(M.t2(d), /seguimos esperando el pago/);
  assert.match(M.t2(d), /\$ 169\.880,16/);
  assert.match(M.t3(d), /nota de crédito de la factura \(NC 0003-00001234\)/);
  assert.match(M.t3({ ...d, nota_credito: '' }, 'cordial'), /correspondiente a la factura\./);
});

test('teléfono para WhatsApp', () => {
  assert.equal(M.telefonoWhatsapp('0353 15 412-3456'), '5493534123456');
  assert.equal(M.telefonoWhatsapp('3534123456'), '5493534123456');
  assert.equal(M.telefonoWhatsapp('+54 9 351 555 1234'), '5493515551234');
  assert.equal(M.telefonoWhatsapp('011 15 5555 1234'), '5491155551234');
  assert.equal(M.telefonoWhatsapp('4123456'), null);
  assert.equal(M.linkWhatsapp('', 'hola'), 'https://wa.me/?text=hola');
});

test('lista de despacho y resumen del día', () => {
  const pedidos = [{ cliente: 'FARMACIA ROCA', transporte: 'VIA CARGO', total: 1626611.47 }, { cliente: 'LA RED SOC', transporte: 'COMISIONISTA', total: 1000, observaciones: 'retira 15 hs' }];
  const l = M.listaDespacho(pedidos, '15:00');
  assert.match(l, /ventana de las 15:00 \(2 pedidos\)/);
  assert.match(l, /• \*FARMACIA ROCA\* — VIA CARGO — \$ 1\.626\.611,47/);
  assert.match(l, /\(retira 15 hs\)/);
  assert.match(M.listaDespacho([], '10:00'), /No hay pedidos/);
  const r = M.resumenDia({ t2: [{ cliente: 'A', total: 10, _detalle: 'venció hace 3 h' }], despachar: pedidos }, { fecha: 'martes 17/11', ventana: '15:00' });
  assert.match(r, /Mandar T2 hoy \(1\):\n• A — \$ 10 \(venció hace 3 h\)/);
  assert.match(r, /Listos para despachar — próxima ventana 15:00 \(2\)/);
  assert.match(M.resumenDia({}, {}), /No hay nada pendiente/);
});
