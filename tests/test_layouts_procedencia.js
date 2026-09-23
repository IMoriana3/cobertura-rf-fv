/* ¿SIGUEN SIENDO LOS LAYOUTS DE `cobertura-zigbee`?
 *
 *   node tests/test_layouts_procedencia.js
 *
 * POR QUE. La misma planta se dibuja en dos sitios —el visor de terreno de
 * `cobertura-zigbee` y este simulador— y cada repo llevaba SU copia del
 * `<planta>_layout.json`. Las copias se separaron sin que nadie se enterase: al
 * HSU1 de Tunez le faltaban su NCU y su GW, a Ayora su bloque `hsu`, a El Burgo
 * `tipos_largo` y `numeracion`, y una errata arreglada en un repo seguia viva en
 * el otro. Ninguna era una decision; eran el poso de copiar a mano.
 *
 * La implantacion es UNA. El CAD se procesa una vez, alli, y aqui se trae con
 * `tools/sincroniza_layouts.py`. Este banco vigila que nadie haya editado una
 * copia por el camino: cada layout tiene que seguir teniendo el sha256 que
 * apunto la sincronizacion.
 *
 * LO QUE ESTE BANCO NO PUEDE VER, y conviene decirlo: si `cobertura-zigbee`
 * avanza y aqui no se sincroniza, los ficheros siguen casando con su
 * PROCEDENCIA y esto sale verde. Eso lo mira el vigia semanal
 * (`.github/workflows/layouts_al_dia.yml`), que SI sale a la red. Aqui no se
 * sale: un banco que depende de que GitHub conteste falla por algo que no es el
 * codigo, y este corre en cada PR.
 *
 * LA MUTACION VA DENTRO. Al final se pasa el mismo verificador por un layout
 * manipulado en memoria y se exige que lo RECHACE. Una comprobacion que nunca
 * se ha visto fallar no es una comprobacion: es un adorno que sale verde.    */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const RAIZ = path.dirname(__dirname);
const PLANTAS = path.join(RAIZ, 'plantas');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/* EL VERIFICADOR, en una funcion aparte a proposito: asi la mutacion de abajo
   puede pasarle un contenido falso y comprobar que lo caza. Devuelve la lista
   de quejas — vacia es que todo cuadra. */
function verifica(proc, lee) {
  const quejas = [];
  const enDisco = fs.readdirSync(PLANTAS).filter(f => f.endsWith('_layout.json')).sort();
  const listados = Object.keys(proc.ficheros || {}).sort();
  enDisco.forEach(f => { if (!listados.includes(f)) quejas.push(`${f} esta en plantas/ y no en PROCEDENCIA`); });
  listados.forEach(f => { if (!enDisco.includes(f)) quejas.push(`PROCEDENCIA lista ${f}, que no esta en plantas/`); });
  listados.filter(f => enDisco.includes(f)).forEach(f => {
    const h = sha(lee(f));
    if (h !== proc.ficheros[f].sha256)
      quejas.push(`${f} no es el que se sincronizo (${h.slice(0, 12)} != ${proc.ficheros[f].sha256.slice(0, 12)})`);
  });
  return quejas;
}

const fProc = path.join(PLANTAS, 'PROCEDENCIA.json');
check('plantas/PROCEDENCIA.json existe', fs.existsSync(fProc));
if (!fs.existsSync(fProc)) { console.log('1 FALLOS (' + ok + ' OK)'); process.exit(1); }
const proc = JSON.parse(fs.readFileSync(fProc, 'utf8'));

/* Sin el commit de origen, la procedencia es un adorno: no se puede volver al
   fichero del que salio esto. */
check('declara de que repo y de que commit salen',
      proc.fuente && proc.fuente.repo === 'IMoriana3/cobertura-zigbee'
        && /^[0-9a-f]{40}$/.test(proc.fuente.commit || ''),
      JSON.stringify(proc.fuente));

const n = Object.keys(proc.ficheros || {}).length;
check('cubre los layouts que sirve la pagina', n >= 8, `${n} listados`);

const lee = f => fs.readFileSync(path.join(PLANTAS, f));
const quejas = verifica(proc, lee);
check('ningun layout se ha tocado a mano desde la sincronizacion',
      quejas.length === 0, quejas.slice(0, 5).join(' · '));

/* Y que los layouts sigan siendo JSON legible, que el sha no lo garantiza. */
let malos = [];
Object.keys(proc.ficheros || {}).forEach(f => {
  try { const j = JSON.parse(lee(f));
        if (!Array.isArray(j.trackers) || !j.trackers.length) malos.push(f + ': sin seguidores'); }
  catch (e) { malos.push(f + ': ' + e.message); }
});
check('y los ocho se abren y traen seguidores', malos.length === 0, malos.join(' · '));

/* ── LA MUTACION ─────────────────────────────────────────────────────────────
   Se le cambia UN numero a un layout, en memoria, y el verificador tiene que
   decir que no. Si esto saliera verde, el banco de arriba no estaria mirando
   nada. */
{
  const victima = Object.keys(proc.ficheros)[0];
  const tocado = f => f === victima
    ? Buffer.from(lee(f).toString('utf8').replace(/"clat":\s*[-\d.]+/, '"clat": 0.1'))
    : lee(f);
  const cambio = tocado(victima).toString() !== lee(victima).toString();
  check('la mutacion de prueba de verdad cambia el fichero', cambio, victima);
  check('un layout editado a mano NO pasa el verificador',
        cambio && verifica(proc, tocado).some(q => q.startsWith(victima)),
        verifica(proc, tocado).join(' · ') || '(no se quejo de nada)');
}

if (ko) { console.log('\n' + ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
console.log('\nTODAS OK (' + ok + ' comprobaciones)');
