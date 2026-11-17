// =====================================================================
//  Plazos y "qué falta" de cada pedido. Sin dependencias: funciona igual
//  en el navegador (window.FacPlazos) y en Node (require), para probarlo.
//
//  Horas hábiles: se cuentan todas las horas, salvo las de los días no
//  hábiles (por defecto, el domingo) y los feriados cargados en Ajustes.
//  Hora de Argentina (UTC-3, sin horario de verano).
// =====================================================================
(function (global) {
  'use strict';

  const HORA = 3600000, DIA = 24 * HORA, DESFASE = -3 * HORA;
  const AJUSTES_DEFECTO = { horas_t2: 48, horas_t3: 24, dias_no_habiles: [0], feriados: [], ventanas: ['10:00', '15:00'] };

  // Un instante -> ms "de reloj argentino" (para cortar por días sin depender del huso de la PC)
  const local = t => new Date(t).getTime() + DESFASE;
  const diaDe = ms => new Date(ms).toISOString().slice(0, 10);
  const inicioDia = ms => ms - (((ms % DIA) + DIA) % DIA);

  function calendario(aj) {
    const a = { ...AJUSTES_DEFECTO, ...(aj || {}) };
    return { noHabiles: new Set(a.dias_no_habiles || []), feriados: new Set(a.feriados || []) };
  }
  const esHabil = (ms, cal) => !cal.noHabiles.has(new Date(ms).getUTCDay()) && !cal.feriados.has(diaDe(ms));

  // Horas hábiles entre dos instantes
  function horasHabiles(desde, hasta, aj) {
    const cal = calendario(aj);
    let a = local(desde);
    const b = local(hasta);
    let ms = 0;
    while (a < b) {
      const fin = Math.min(b, inicioDia(a) + DIA);
      if (esHabil(a, cal)) ms += fin - a;
      a = fin;
    }
    return ms / HORA;
  }

  // Instante en que se cumplen "horas" hábiles contadas desde "desde"
  function vencimiento(desde, horas, aj) {
    const cal = calendario(aj);
    let a = local(desde), resta = horas * HORA;
    for (let vueltas = 0; vueltas < 400; vueltas++) {
      const fin = inicioDia(a) + DIA;
      if (esHabil(a, cal)) {
        if (fin - a >= resta) return new Date(a + resta - DESFASE);
        resta -= fin - a;
      }
      a = fin;
    }
    return new Date(a - DESFASE);
  }

  // "2 h", "1 día y 3 h", "3 días"
  function duracion(horas) {
    const h = Math.max(0, Math.round(horas));
    if (h < 1) return 'menos de 1 h';
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24), r = h % 24;
    const dias = `${d} ${d === 1 ? 'día' : 'días'}`;
    return r && d < 3 ? `${dias} y ${r} h` : dias;
  }

  // Lo próximo que hay que hacer con un pedido.
  // Devuelve { clave, texto, detalle, urgente, quien } o null si no falta nada.
  //   quien: 'facturacion' | 'administracion' (para la bandeja de cada rol)
  function pendiente(p, aj, ahora = new Date()) {
    const a = { ...AJUSTES_DEFECTO, ...(aj || {}) };
    switch (p.estado) {
      case 'facturado': {
        const desde = p.creado_en || p.fecha;
        const h = desde ? horasHabiles(desde, ahora, a) : 0;
        return { clave: 't1', texto: 'Mandar T1', detalle: h >= 1 ? `facturado hace ${duracion(h)}` : 'recién facturado',
          urgente: h >= 4, quien: 'facturacion' };
      }
      case 'esperando_pago': {
        if (!p.t2_en) {
          const vence = vencimiento(p.t1_en || p.creado_en, a.horas_t2, a);
          if (ahora >= vence) {
            const h = horasHabiles(vence, ahora, a);
            return { clave: 't2', texto: 'Mandar T2', detalle: `sin pago desde el T1 (${a.horas_t2} h hábiles)${h >= 1 ? `, venció hace ${duracion(h)}` : ''}`,
              urgente: true, quien: 'facturacion' };
          }
          return { clave: 'esperar', texto: 'Esperando pago', detalle: `T2 en ${duracion(horasHabiles(ahora, vence, a))} hábiles`, urgente: false, quien: 'facturacion', vence };
        }
        const vence = vencimiento(p.t2_en, a.horas_t3, a);
        if (ahora >= vence) {
          return { clave: 'baja', texto: 'Dar de baja (T3)', detalle: `sin respuesta al T2 (${a.horas_t3} h hábiles)`, urgente: true, quien: 'facturacion' };
        }
        return { clave: 'esperar_t2', texto: 'Esperando respuesta al T2', detalle: `baja en ${duracion(horasHabiles(ahora, vence, a))} hábiles`, urgente: false, quien: 'facturacion', vence };
      }
      case 'pago_informado': {
        const h = p.pago_informado_en ? horasHabiles(p.pago_informado_en, ahora, a) : 0;
        return { clave: 'confirmar', texto: 'Confirmar pago', detalle: h >= 1 ? `informado hace ${duracion(h)}` : 'recién informado',
          urgente: h >= 24, quien: 'administracion' };
      }
      case 'listo':
        return { clave: 'despachar', texto: 'Despachar', detalle: 'próxima ventana', urgente: false, quien: 'facturacion' };
      case 'baja':
        return p.nota_credito ? null
          : { clave: 'nc', texto: 'Cargar la nota de crédito', detalle: 'dado de baja sin n° de NC', urgente: false, quien: 'facturacion' };
      default:
        return null;
    }
  }

  // Próxima ventana de despacho: { hora: "15:00", dia: "hoy" | "mañana" | "YYYY-MM-DD" }
  function proximaVentana(aj, ahora = new Date()) {
    const a = { ...AJUSTES_DEFECTO, ...(aj || {}) };
    const cal = calendario(a);
    const ventanas = [...(a.ventanas || [])].filter(v => /^\d{1,2}:\d{2}$/.test(v)).sort((x, y) => minutos(x) - minutos(y));
    if (!ventanas.length) return null;
    const ms = local(ahora);
    let dia = inicioDia(ms);
    for (let i = 0; i < 30; i++, dia += DIA) {
      if (!esHabil(dia, cal)) continue;
      for (const v of ventanas) {
        if (dia + minutos(v) * 60000 > ms) {
          return { hora: v, dia: i === 0 ? 'hoy' : i === 1 ? 'mañana' : diaDe(dia) };
        }
      }
    }
    return { hora: ventanas[0], dia: 'mañana' };
  }
  function minutos(v) { const [h, m] = v.split(':').map(Number); return h * 60 + m; }

  const api = { horasHabiles, vencimiento, duracion, pendiente, proximaVentana, AJUSTES_DEFECTO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.FacPlazos = api;
})(typeof window !== 'undefined' ? window : globalThis);
