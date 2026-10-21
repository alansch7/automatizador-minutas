#!/usr/bin/env node
/**
 * Uso:
 *   node src/cli.js <transcripcion.txt> [--json] [--salida acta.md] [--fecha AAAA-MM-DD] [--titulo "..."]
 * Sin archivo, lee la transcripción desde stdin.
 */
const fs = require('node:fs');
const { generarActa, aMarkdown } = require('./minutas.js');

function leerArgs(argv) {
  const args = { archivo: null, json: false, salida: null, fecha: undefined, titulo: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--salida' || a === '-o') args.salida = argv[++i];
    else if (a === '--fecha') args.fecha = argv[++i];
    else if (a === '--titulo') args.titulo = argv[++i];
    else if (a === '--help' || a === '-h') args.ayuda = true;
    else args.archivo = a;
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));
if (args.ayuda) {
  console.log('Uso: node src/cli.js <transcripcion.txt> [--json] [--salida acta.md] [--fecha AAAA-MM-DD] [--titulo "..."]');
  process.exit(0);
}

const texto = fs.readFileSync(args.archivo || 0, 'utf8');
const acta = generarActa(texto, { fecha: args.fecha, titulo: args.titulo });
const salida = args.json ? JSON.stringify(acta, null, 2) + '\n' : aMarkdown(acta);

if (args.salida) {
  fs.writeFileSync(args.salida, salida, 'utf8');
  console.error(`Acta guardada en ${args.salida} (${acta.compromisos.length} compromisos, ${acta.decisiones.length} decisiones).`);
} else {
  process.stdout.write(salida);
}
