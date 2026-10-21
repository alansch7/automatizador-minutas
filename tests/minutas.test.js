const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/minutas.js');

const REUNION = '2026-10-19'; // lunes
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', 'ejemplos', f), 'utf8');

test('normalizar conserva el largo del texto', () => {
  const s = 'Mañana revisión ÁRBOL';
  assert.equal(M.normalizar(s), 'manana revision arbol');
  assert.equal(M.normalizar(s).length, s.length);
});

test('fechas relativas a la reunión', () => {
  const f = (t) => M.extraerFecha(t, REUNION)?.fecha ?? null;
  assert.equal(f('para mañana'), '2026-10-20');
  assert.equal(f('pasado mañana'), '2026-10-21');
  assert.equal(f('hoy mismo'), '2026-10-19');
  assert.equal(f('para el jueves'), '2026-10-22');
  assert.equal(f('el próximo lunes'), '2026-10-26'); // mismo día de semana => la semana siguiente
  assert.equal(f('la próxima semana'), '2026-10-30'); // viernes de la semana siguiente
  assert.equal(f('el 28 de octubre'), '2026-10-28');
  assert.equal(f('el 5 de enero'), '2027-01-05'); // ya pasó este año => año siguiente
  assert.equal(f('antes del 15/11'), '2026-11-15');
  assert.equal(f('a fin de mes'), '2026-10-31');
  assert.equal(f('en dos semanas'), '2026-11-02');
  assert.equal(f('sin plazo'), null);
});

test('la expresión de fecha se quita del texto de la tarea', () => {
  const c = M.detectarCompromiso('Me encargo de enviar el informe para el viernes.', 'Ana Pérez', () => null, REUNION);
  assert.deepEqual(c, { tarea: 'Enviar el informe', responsable: 'Ana Pérez', fecha: '2026-10-23' });
});

test('parsea encabezados, hablantes y líneas de continuación', () => {
  const { meta, intervenciones } = M.parsearTranscripcion(
    'Reunión: Demo\nFecha: 2026-10-19\n[10:00] Ana Pérez: Hola.\nsigo hablando\nLuis Díaz: Ok.'
  );
  assert.equal(meta.titulo, 'Demo');
  assert.equal(meta.fecha, '2026-10-19');
  assert.equal(intervenciones.length, 2);
  assert.equal(intervenciones[0].texto, 'Hola. sigo hablando');
  assert.equal(intervenciones[1].hora, '');
});

test('acta del seguimiento semanal de ejemplo', () => {
  const acta = M.generarActa(leer('seguimiento-semanal.txt'));
  assert.equal(acta.asistentes.length, 5);
  assert.deepEqual(acta.temas, ['Comunicaciones', 'Plan de olas']);
  assert.equal(acta.decisiones.length, 2);

  const resumen = acta.compromisos.map((c) => [c.responsable, c.fecha]);
  assert.deepEqual(resumen, [
    ['Matías Herrera', '2026-10-22'],   // vocativo: "Matías, ¿puedes…?"
    ['Ignacio Morales', '2026-10-21'],  // primera persona
    ['Rodrigo Vidal', '2026-10-20'],    // pasiva: "queda a cargo de Rodrigo"
    ['Fernanda Paredes', '2026-10-28'], // fecha explícita
    ['Fernanda Paredes', '2026-10-30'], // tercera persona + "la próxima semana"
    ['Valentina Soto', '2026-10-19']    // "quedo con … hoy mismo"
  ]);
  assert.equal(acta.compromisos[2].tarea, 'La aprobación del comunicado');

  assert.equal(acta.riesgos.length, 2); // "sin problema" no cuenta como riesgo
  assert.equal(acta.sinResponsable.length, 1);
});

test('acta del comité de cambios usa los asistentes declarados', () => {
  const acta = M.generarActa(leer('comite-cambios.txt'));
  assert.equal(acta.asistentes.length, 4);
  const regresion = acta.compromisos.find((c) => /regresi/.test(c.tarea));
  assert.equal(regresion.responsable, 'Javier Ortega');
  assert.equal(regresion.fecha, '2026-11-30');
});

test('markdown incluye la tabla de compromisos', () => {
  const md = M.aMarkdown(M.generarActa(leer('seguimiento-semanal.txt')));
  assert.match(md, /^# Acta: Seguimiento semanal/);
  assert.match(md, /\| 1 \| Preparar un escaneo de rutas largas de todas las bibliotecas \| Matías Herrera \| 22-10-2026 \|/);
});
