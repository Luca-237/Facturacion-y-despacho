// =====================================================================
//  Mensajes armados con plantillas (sin IA): T1, T2, T3, resumen del día
//  y lista de despacho. Mismo contenido que el "Generador de mensajes",
//  pero con los datos del pedido ya cargados.
//  Funciona igual en el navegador (window.FacMensajes) y en Node (require).
// =====================================================================
(function (global) {
  'use strict';

  const TONOS = { cercano: 'Cercano y cálido', cordial: 'Cordial y profesional', formal: 'Formal' };

  // $ 171.416,45 (sin decimales si son ,00)
  function pesos(n) {
    const v = Number(n || 0);
    const dec = Math.round(v * 100) % 100 !== 0 ? 2 : 0;
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  // "PARRA AGOSTINA" -> "Parra Agostina" (se puede corregir a mano antes de copiar)
  function nombreSaludo(cliente) {
    return String(cliente || '').trim().toLowerCase()
      .replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
      .replace(/\b(De|Del|La|Las|Los|Y|E)\b/g, (m, x, i) => (i === 0 ? m : m.toLowerCase()));
  }

  // "$ 171.416,45" o "$ 171.416,45 (parte 1) + $ 98.993 (parte 2), total $ 270.409,45"
  function importeTexto(p) {
    const i1 = Number(p.importe_1 || 0), i2 = Number(p.importe_2 || 0);
    if (i1 && i2) return `${pesos(i1)} (parte 1) + ${pesos(i2)} (parte 2), total ${pesos(i1 + i2)}`;
    return pesos(i1 + i2);
  }

  const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  // Cómo sale el pedido, según el transporte
  function textoEnvio(transporte, tono) {
    const t = sinTildes(transporte);
    const usted = tono === 'formal';
    if (!t) return '';
    if (/RETIRA/.test(t)) return usted ? 'Puede retirarlo por el local una vez acreditado el pago.' : 'Lo podés retirar por el local cuando esté acreditado el pago.';
    if (/COMISIONISTA/.test(t)) return usted ? 'Lo retira su comisionista, que firma el remito al retirar.' : 'Lo retira tu comisionista (firma el remito al retirar).';
    if (/DOMICILIO/.test(t)) return usted ? 'Se lo entregamos en su domicilio.' : 'Te lo llevamos a tu domicilio.';
    return usted ? `El envío se realiza por ${transporte}.` : `El envío sale por ${transporte}.`;
  }

  function saludoFormal(ahora = new Date()) {
    const h = Number(new Date(ahora).toLocaleString('en-US', { timeZone: 'America/Argentina/Cordoba', hour: 'numeric', hour12: false }));
    return h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  }

  const unir = partes => partes.filter(x => x != null && x !== false && String(x).trim() !== '').join('\n\n');

  // d: { nombre, importe (texto), alias, transporte, faltantes, aclaraciones, nota_credito }
  function t1(d, tono = 'cercano', ahora) {
    const envio = textoEnvio(d.transporte, tono);
    const falt = d.faltantes ? (tono === 'formal' ? `Le informamos que en el pedido hay faltantes: ${d.faltantes}.` : `Te aviso que en el pedido hay faltantes: ${d.faltantes}.`) : '';
    if (tono === 'formal') {
      return unir([
        `${saludoFormal(ahora)}, ${d.nombre}. Le enviamos la factura y el rótulo de su pedido para que pueda verificar los datos.`,
        `El importe total es de ${d.importe}.${d.alias ? `\nPuede realizar el pago al alias ${d.alias}.` : ''}`,
        envio, falt, d.aclaraciones,
        'Una vez realizado el pago, le pedimos que nos envíe el comprobante por este medio para despachar el pedido. Quedamos a su disposición.',
      ]);
    }
    if (tono === 'cordial') {
      return unir([
        `Hola ${d.nombre}, ¿cómo estás? Te enviamos la factura y el rótulo de tu pedido para que puedas verificar los datos.`,
        `El importe total es de ${d.importe}.${d.alias ? `\nPodés realizar el pago al alias ${d.alias}.` : ''}`,
        envio, falt, d.aclaraciones,
        'Cuando realices el pago, envianos el comprobante por acá así despachamos el pedido. Quedamos a disposición. ¡Muchas gracias!',
      ]);
    }
    return unir([
      `¡Hola ${d.nombre}! ¿Cómo estás? 😊 Te mandamos la factura y el rótulo de tu pedido para que revises que esté todo bien.`,
      `El total es de ${d.importe}.${d.alias ? `\nPodés transferir al alias ${d.alias}.` : ''}`,
      envio, falt, d.aclaraciones,
      'Cuando hagas el pago, mandanos el comprobante por acá así lo despachamos. ¡Muchas gracias!',
    ]);
  }

  function t2(d, tono = 'cercano', ahora) {
    if (tono === 'formal') {
      return unir([
        `${saludoFormal(ahora)}, ${d.nombre}. Nos comunicamos nuevamente porque aún no registramos el pago de su pedido, necesario para poder despacharlo.`,
        `Importe pendiente: ${d.importe}.${d.alias ? `\nAlias: ${d.alias}.` : ''}`,
        'Si ya realizó el pago, le pedimos que nos envíe el comprobante. Quedamos atentos.',
      ]);
    }
    if (tono === 'cordial') {
      return unir([
        `Hola ${d.nombre}, te contactamos nuevamente porque estamos a la espera del pago para poder despachar tu pedido.`,
        `Importe pendiente: ${d.importe}.${d.alias ? `\nAlias: ${d.alias}.` : ''}`,
        'Si ya lo realizaste, envianos el comprobante por acá. Quedamos atentos. ¡Muchas gracias!',
      ]);
    }
    return unir([
      `¡Hola ${d.nombre}! Te escribimos de nuevo porque seguimos esperando el pago de tu pedido para poder despacharlo.`,
      `Importe pendiente: ${d.importe}.${d.alias ? `\nAlias: ${d.alias}.` : ''}`,
      'Si ya lo hiciste, mandanos el comprobante por acá. ¡Gracias!',
    ]);
  }

  function t3(d, tono = 'cercano', ahora) {
    const nc = d.nota_credito ? ` (${d.nota_credito})` : '';
    if (tono === 'formal') {
      return unir([
        `${saludoFormal(ahora)}, ${d.nombre}. Lamentamos informarle que, al no haber recibido respuesta, procedimos a dar de baja su pedido.`,
        `Emitimos la nota de crédito correspondiente a la factura${nc}.`,
        'Cuando desee realizar un nuevo pedido, quedamos a su disposición.',
      ]);
    }
    if (tono === 'cordial') {
      return unir([
        `Hola ${d.nombre}, lamentamos informarte que, al no haber recibido respuesta de tu parte, procedimos a dar de baja tu pedido.`,
        `Emitimos la nota de crédito correspondiente a la factura${nc}.`,
        'Cuando quieras renovar el pedido, estamos disponibles. ¡Muchas gracias por tu comprensión!',
      ]);
    }
    return unir([
      `Hola ${d.nombre}. Como no tuvimos respuesta, dimos de baja tu pedido y emitimos la nota de crédito de la factura${nc}.`,
      'Cuando quieras volver a hacer el pedido, escribinos y lo armamos. ¡Gracias por tu comprensión!',
    ]);
  }

  const PLANTILLAS = { t1, t2, t3 };

  // Datos para las plantillas a partir de un pedido
  function datosDe(p, extra = {}) {
    return {
      nombre: nombreSaludo(p.cliente), importe: importeTexto(p), alias: p.alias_pago || '',
      transporte: p.transporte || '', faltantes: p.faltantes || '', aclaraciones: '', nota_credito: p.nota_credito || '',
      ...extra,
    };
  }

  // ---------- WhatsApp ----------
  // "0353 15 412-3456" -> "5493534123456". null si no parece un celular argentino.
  function telefonoWhatsapp(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return null;
    d = d.replace(/^00/, '');
    if (d.startsWith('54')) { d = d.slice(2); if (d.startsWith('9')) d = d.slice(1); }
    d = d.replace(/^0/, '');
    if (d.length === 12) {
      for (const area of [4, 3, 2]) {
        if (d.substr(area, 2) === '15') { d = d.slice(0, area) + d.slice(area + 2); break; }
      }
    }
    return d.length === 10 ? '549' + d : null;
  }
  function linkWhatsapp(tel, texto) {
    const n = telefonoWhatsapp(tel);
    const t = encodeURIComponent(texto || '');
    return n ? `https://wa.me/${n}?text=${t}` : `https://wa.me/?text=${t}`;
  }

  // ---------- Lista de despacho (para Facu y Lorenzo) ----------
  function listaDespacho(pedidos, ventana) {
    if (!pedidos.length) return `¡Buenas! Para la ventana de las ${ventana}:\n\nNo hay pedidos para despachar. 🙌`;
    const lineas = pedidos.map(p => `• *${p.cliente}* — ${p.transporte || 'sin transporte'} — ${pesos(p.total ?? (Number(p.importe_1 || 0) + Number(p.importe_2 || 0)))}${p.observaciones ? ` (${p.observaciones})` : ''}`);
    return `¡Buenas! Para la ventana de las ${ventana} (${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}):\n\n${lineas.join('\n')}\n\nAvisame cualquier duda 🙌`;
  }

  // ---------- Resumen del día ----------
  // grupos: { t1, t2, baja, confirmar, despachar, esperando, despachadosHoy } (listas de pedidos)
  function resumenDia(grupos, { fecha, ventana } = {}) {
    const linea = p => `• ${p.cliente}${p.transporte ? ' — ' + p.transporte : ''} — ${pesos(p.total)}${p._detalle ? ` (${p._detalle})` : ''}`;
    const seccion = (titulo, lista) => (lista && lista.length ? `${titulo} (${lista.length}):\n${lista.map(linea).join('\n')}` : '');
    const partes = [
      `Resumen de facturación${fecha ? ' — ' + fecha : ''}`,
      seccion('🚨 Mandar T2 hoy', grupos.t2),
      seccion('❌ Dar de baja (sin respuesta al T2)', grupos.baja),
      seccion('✉️ Falta mandar el T1', grupos.t1),
      seccion('🩷 Pagos a confirmar (administración)', grupos.confirmar),
      seccion(`🟡 Listos para despachar${ventana ? ' — próxima ventana ' + ventana : ''}`, grupos.despachar),
      seccion('⏳ Esperando pago (en plazo)', grupos.esperando),
      seccion('🟢 Despachados hoy', grupos.despachadosHoy),
    ];
    const total = ['t2', 'baja', 't1', 'confirmar', 'despachar'].reduce((n, k) => n + ((grupos[k] || []).length), 0);
    if (!total && !(grupos.esperando || []).length) partes.push('No hay nada pendiente. 🙌');
    return unir(partes);
  }

  const api = { TONOS, PLANTILLAS, pesos, nombreSaludo, importeTexto, textoEnvio, datosDe, t1, t2, t3, telefonoWhatsapp, linkWhatsapp, listaDespacho, resumenDia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.FacMensajes = api;
})(typeof window !== 'undefined' ? window : globalThis);
