/**
 * Motor de minutas: transforma una transcripción de reunión en un acta
 * estructurada (asistentes, temas, decisiones, compromisos con responsable
 * y fecha, riesgos y pendientes sin dueño) usando reglas deterministas.
 *
 * Funciona en el navegador (window.Minutas) y en Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Minutas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const NUMEROS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, diez: 10, quince: 15 };
  const NOMBRE = '[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?';

  // ---------------------------------------------------------------------------
  // Utilidades de texto
  // ---------------------------------------------------------------------------

  /**
   * Minúsculas sin tildes, conservando el largo del texto carácter a carácter,
   * para que los índices de un match sobre el texto normalizado sirvan en el original.
   */
  function normalizar(texto) {
    const mapa = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
    return Array.from(texto.toLowerCase(), (c) => mapa[c] || c).join('');
  }

  function capitalizar(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /** Limpia un fragmento de tarea: espacios, puntuación y conectores sueltos al final. */
  function limpiarTarea(s) {
    return capitalizar(
      s.replace(/\s{2,}/g, ' ')
        .replace(/^[\s,:;¿¡]+/, '')
        .replace(/^(?:además|entonces|también|bueno|y|o sea)[,\s]+/i, '')
        .replace(/[\s,;:.?!¿¡]+$/, '')
        .replace(/\s+(para|y|antes|hasta|el|la|a)$/i, '')
        .trim()
    );
  }

  function dividirOraciones(texto) {
    return texto.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Fechas
  // ---------------------------------------------------------------------------

  function isoDesde(fecha) {
    return fecha.toISOString().slice(0, 10);
  }

  function sumarDias(fecha, n) {
    const d = new Date(fecha);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }

  /**
   * Busca una expresión de plazo en el texto y la resuelve a una fecha ISO,
   * tomando como referencia la fecha de la reunión.
   * Devuelve { fecha, inicio, fin } (índices sobre el texto) o null.
   */
  function extraerFecha(texto, fechaReunion) {
    const n = normalizar(texto);
    const base = new Date(fechaReunion + 'T00:00:00Z');
    const dow = base.getUTCDay();
    const prefijo = '(?:(?:para|antes del?|hasta el|a mas tardar el)\\s+)?';

    const reglas = [
      {
        re: new RegExp(prefijo + '(?:el\\s+)?(\\d{1,2}) de (' + MESES.join('|') + ')(?: de (\\d{4}))?', 'g'),
        resolver: (m) => {
          const mes = MESES.indexOf(m[2]);
          let anio = m[3] ? Number(m[3]) : base.getUTCFullYear();
          let d = new Date(Date.UTC(anio, mes, Number(m[1])));
          if (!m[3] && d < base) d = new Date(Date.UTC(anio + 1, mes, Number(m[1])));
          return d;
        }
      },
      {
        re: new RegExp(prefijo + '(?:el\\s+)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b', 'g'),
        resolver: (m) => {
          let anio = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : base.getUTCFullYear();
          let d = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[1])));
          if (!m[3] && d < base) d = new Date(Date.UTC(anio + 1, Number(m[2]) - 1, Number(m[1])));
          return d;
        }
      },
      { re: new RegExp(prefijo + 'pasado manana\\b', 'g'), resolver: () => sumarDias(base, 2) },
      { re: new RegExp(prefijo + '\\bmanana\\b', 'g'), resolver: () => sumarDias(base, 1) },
      { re: new RegExp(prefijo + '\\bhoy(?: mismo)?\\b', 'g'), resolver: () => base },
      {
        re: new RegExp(prefijo + '(?:(?:el|este)\\s+)?(?:proximo\\s+)?\\b(' + DIAS.join('|') + ')\\b', 'g'),
        resolver: (m) => sumarDias(base, (DIAS.indexOf(m[1]) - dow + 7) % 7 || 7)
      },
      {
        re: new RegExp(prefijo + '(?:durante\\s+)?(?:la\\s+)?(?:proxima|otra) semana', 'g'),
        resolver: () => sumarDias(base, ((1 - dow + 7) % 7 || 7) + 4) // viernes de la semana siguiente
      },
      {
        re: new RegExp('(?:(?:para|antes de|a)\\s+)?fin(?:es)? de mes', 'g'),
        resolver: () => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0))
      },
      {
        re: /(?:(?:para|antes de|dentro de)\s+)?\ben (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|diez|quince) (dias?|semanas?)\b/g,
        resolver: (m) => {
          const cant = /\d/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
          return sumarDias(base, m[2].startsWith('semana') ? cant * 7 : cant);
        }
      }
    ];

    let mejor = null;
    for (const { re, resolver } of reglas) {
      re.lastIndex = 0;
      const m = re.exec(n);
      if (!m) continue;
      const d = resolver(m);
      if (isNaN(d)) continue;
      // Ante varias expresiones, gana la que aparece primero en la oración.
      if (!mejor || m.index < mejor.inicio) mejor = { fecha: isoDesde(d), inicio: m.index, fin: m.index + m[0].length };
    }
    return mejor;
  }

  // ---------------------------------------------------------------------------
  // Parsing de la transcripción
  // ---------------------------------------------------------------------------

  /**
   * Formato esperado (encabezados opcionales):
   *   Reunión: <título>
   *   Fecha: AAAA-MM-DD
   *   [09:00] Nombre Apellido: lo que dijo...
   * Las líneas sin hablante se agregan a la intervención anterior.
   */
  function parsearTranscripcion(texto) {
    const meta = { titulo: '', fecha: '', asistentesDeclarados: [] };
    const intervenciones = [];
    const reLinea = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.]*(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.]*){0,3})\s*:\s*(.+)$/;

    for (const cruda of texto.split(/\r?\n/)) {
      const linea = cruda.trim();
      if (!linea) continue;
      const enc = linea.match(/^(reuni[oó]n|t[ií]tulo|fecha|asistentes)\s*:\s*(.+)$/i);
      if (enc) {
        const clave = normalizar(enc[1]);
        if (clave === 'fecha') meta.fecha = enc[2].trim();
        else if (clave === 'asistentes') meta.asistentesDeclarados = enc[2].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        else meta.titulo = enc[2].trim();
        continue;
      }
      const m = linea.match(reLinea);
      if (m) intervenciones.push({ hora: m[1] || '', hablante: m[2].trim(), texto: m[3].trim() });
      else if (intervenciones.length) intervenciones[intervenciones.length - 1].texto += ' ' + linea;
    }
    return { meta, intervenciones };
  }

  /** Resuelve un nombre mencionado ("Matías") al asistente completo ("Matías Herrera"). */
  function crearResolvedor(asistentes) {
    return function resolver(mencion) {
      const palabras = mencion.split(/\s+/);
      // Se prueba la mención completa y luego cada palabra (p.ej. "Entonces Fernanda" -> "Fernanda").
      for (const candidato of [mencion, ...palabras]) {
        const c = normalizar(candidato);
        const exacto = asistentes.find((a) => normalizar(a) === c);
        if (exacto) return exacto;
        const porNombre = asistentes.filter((a) => normalizar(a).split(/\s+/)[0] === c);
        if (porNombre.length === 1) return porNombre[0];
      }
      return null;
    };
  }

  // ---------------------------------------------------------------------------
  // Reglas de extracción
  // ---------------------------------------------------------------------------

  const RE_PRIMERA_PERSONA = /\b(?:yo\s+)?(?:me encargo de|me comprometo a|me hago cargo de|quedo a cargo de|quedo con|me ocupo de|lo veo yo y|yo (?=preparo|envio|mando|reviso|coordino|agendo|hago|armo|levanto|valido|actualizo|subo|llamo))\s*/;
  const RE_TERCERA_PERSONA = new RegExp('(' + NOMBRE + ')\\s+(?:se encarga de|se compromete a|se hace cargo de|queda con|se ocupa de)\\s+');
  const RE_PASIVA = new RegExp('^(.+?)\\s+queda(?:n)?\\s+a cargo de\\s+(' + NOMBRE + ')');
  const RE_VOCATIVO = new RegExp('^(?:y\\s+)?(' + NOMBRE + '),\\s*¿?\\s*(?:te encargas de|te encargarías de|puedes|podrías|me ayudas con)\\s+(.+)$');
  const RE_RESPONSABLE = new RegExp('responsable:\\s*(' + NOMBRE + ')', 'i');

  const RE_DECISION = /\b(acordamos|se acuerda|quedamos de acuerdo|queda acordado|se decide|decidimos|queda aprobad[oa]|se aprueba|aprobamos|definimos que|se define que)\b/;
  const RE_RIESGO = /\b(riesgo|me preocupa|preocupacion|bloque[oa]|bloqueado|atraso|atrasad[oa]|no alcanza|no alcanzamos|problema|dependemos de|impedimento)\b/;
  const RE_NO_RIESGO = /\b(sin problemas?|no hay problemas?|ningun problema)\b/;
  const RE_TEMA = /^(?:pasemos a|el siguiente tema|siguiente tema|siguiente punto|el siguiente punto|vamos con|revisemos|punto \d+[:.]?)\s*(.+)$/;
  const RE_SIN_DUENO = /\b(hay que|habria que|tenemos que|falta|queda pendiente|alguien tendria que)\b/;

  /** Intenta interpretar una oración como compromiso. */
  function detectarCompromiso(oracion, hablante, resolver, fechaReunion) {
    const n = normalizar(oracion);
    let responsable = null;
    let inicioTarea = -1;
    let finTarea = oracion.length;

    let m = oracion.match(RE_PASIVA);
    if (m && resolver(m[2])) {
      responsable = resolver(m[2]);
      inicioTarea = 0;
      finTarea = m[1].length;
      // la fecha puede venir después del nombre: se busca en toda la oración
      const f = extraerFecha(oracion, fechaReunion);
      return armar(oracion.slice(0, finTarea), f && f.inicio >= finTarea ? null : f, f);
    }

    if (!responsable && (m = oracion.match(RE_VOCATIVO)) && resolver(m[1])) {
      responsable = resolver(m[1]);
      inicioTarea = oracion.length - m[2].length;
    }
    if (!responsable && (m = oracion.match(RE_TERCERA_PERSONA)) && resolver(m[1])) {
      responsable = resolver(m[1]);
      inicioTarea = m.index + m[0].length;
    }
    if (!responsable && (m = n.match(RE_PRIMERA_PERSONA))) {
      responsable = hablante;
      inicioTarea = m.index + m[0].length;
    }
    if (!responsable) return null;

    const r = oracion.match(RE_RESPONSABLE);
    if (r && resolver(r[1])) {
      responsable = resolver(r[1]);
      finTarea = r.index;
    }
    const tarea = oracion.slice(inicioTarea, finTarea);
    return armar(tarea, extraerFecha(tarea, fechaReunion));

    function armar(fragmento, fechaEnFragmento, fechaGlobal) {
      const f = fechaEnFragmento || fechaGlobal || null;
      let texto = fragmento;
      if (fechaEnFragmento) texto = fragmento.slice(0, fechaEnFragmento.inicio) + ' ' + fragmento.slice(fechaEnFragmento.fin);
      texto = limpiarTarea(texto);
      if (texto.length < 4) return null;
      return { tarea: texto, responsable, fecha: f ? f.fecha : null };
    }
  }

  /**
   * Genera el acta completa a partir del texto de la transcripción.
   * @param {string} texto
   * @param {{titulo?: string, fecha?: string}} opciones valores por defecto si no vienen en la transcripción
   */
  function generarActa(texto, opciones = {}) {
    const { meta, intervenciones } = parsearTranscripcion(texto);
    const fecha = meta.fecha || opciones.fecha || new Date().toISOString().slice(0, 10);
    const titulo = meta.titulo || opciones.titulo || 'Reunión sin título';

    const asistentes = [...new Set([...meta.asistentesDeclarados, ...intervenciones.map((i) => i.hablante)])];
    const resolver = crearResolvedor(asistentes);

    const acta = { titulo, fecha, asistentes, temas: [], decisiones: [], compromisos: [], riesgos: [], sinResponsable: [] };

    for (const iv of intervenciones) {
      for (const oracion of dividirOraciones(iv.texto)) {
        const n = normalizar(oracion);
        const fuente = { hablante: iv.hablante, hora: iv.hora };

        const tema = n.match(RE_TEMA);
        if (tema) acta.temas.push(limpiarTarea(oracion.slice(oracion.length - tema[1].length)));

        if (RE_DECISION.test(n)) acta.decisiones.push({ texto: limpiarTarea(oracion), ...fuente });

        const c = detectarCompromiso(oracion, iv.hablante, resolver, fecha);
        if (c) acta.compromisos.push({ ...c, ...fuente });
        else if (RE_SIN_DUENO.test(n)) acta.sinResponsable.push({ texto: limpiarTarea(oracion), ...fuente });

        if (RE_RIESGO.test(n) && !RE_NO_RIESGO.test(n)) acta.riesgos.push({ texto: limpiarTarea(oracion), ...fuente });
      }
    }
    acta.compromisos.forEach((c, i) => (c.id = i + 1));
    return acta;
  }

  // ---------------------------------------------------------------------------
  // Salida
  // ---------------------------------------------------------------------------

  function formatearFecha(iso) {
    if (!iso) return 'Por definir';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }

  function aMarkdown(acta) {
    const celda = (s) => String(s).replace(/\|/g, '\\|');
    const fuente = (x) => (x.hora ? `${x.hablante} (${x.hora})` : x.hablante);
    const lista = (arr, fn) => (arr.length ? arr.map((x) => `- ${fn(x)}`).join('\n') : '_Sin registros._');

    const lineas = [
      `# Acta: ${acta.titulo}`,
      '',
      `**Fecha:** ${formatearFecha(acta.fecha)}  `,
      `**Asistentes:** ${acta.asistentes.join(', ') || '—'}`,
      '',
      '## Temas tratados',
      lista(acta.temas, (t) => t),
      '',
      '## Decisiones',
      lista(acta.decisiones, (d) => `${d.texto} — _${fuente(d)}_`),
      '',
      '## Compromisos',
      acta.compromisos.length
        ? ['| # | Compromiso | Responsable | Fecha |', '|---|---|---|---|',
           ...acta.compromisos.map((c) => `| ${c.id} | ${celda(c.tarea)} | ${celda(c.responsable)} | ${formatearFecha(c.fecha)} |`)].join('\n')
        : '_Sin compromisos detectados._',
      '',
      '## Riesgos y alertas',
      lista(acta.riesgos, (r) => `${r.texto} — _${fuente(r)}_`),
      '',
      '## Pendientes sin responsable',
      lista(acta.sinResponsable, (p) => `${p.texto} — _${fuente(p)}_`),
      '',
      '---',
      '_Acta generada automáticamente a partir de la transcripción. Revisar antes de enviar._',
      ''
    ];
    return lineas.join('\n');
  }

  return { normalizar, extraerFecha, parsearTranscripcion, detectarCompromiso, generarActa, aMarkdown, formatearFecha };
});
