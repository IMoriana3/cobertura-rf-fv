/* ¿SIGUEN SIENDO LOS DE `cobertura-zigbee`? (layouts y módulos comunes)
 *
 *   node tests/test_procedencia.js
 *
 * POR QUE. La misma planta se dibuja en dos sitios —el visor de terreno de
 * `cobertura-zigbee` y este simulador— y con el mismo modelo de seguidor. Cada
 * repo llevaba SU copia y las copias se separaron sin que nadie se enterase. En
 * los layouts, al HSU1 de Tunez le faltaban su NCU y su GW. En los MODULOS, que
 * es peor: `seguidor.js` iba 59 lineas por detras y las DOS copias decian ser la
 * `0.4.23` — una version que miente quita justo la pregunta que lo habria
 * descubierto. Ninguna era una decision: eran el poso de copiar a mano.
 *
 * Se traen con `tools/sincroniza_desde_zigbee.py`. Este banco vigila que nadie
 * haya editado una copia por el camino: cada fichero tiene que seguir teniendo
 * el sha256 que apunto la sincronizacion.
 *
 * LO QUE ESTE BANCO NO PUEDE VER, y conviene decirlo: si el origen AVANZA y aqui
 * no se sincroniza, los ficheros siguen casando con su PROCEDENCIA y esto sale
 * verde. Eso lo mira el vigia semanal (`.github/workflows/layouts_al_dia.yml`),
 * que SI sale a la red. Aqui no: un banco que depende de que GitHub conteste
 * falla por algo que no es el codigo, y este corre en cada PR.
 *
 * LA MUTACION VA DENTRO. Al final se pasa el mismo verificador por un fichero
 * manipulado en memoria y se exige que lo RECHACE. Una comprobacion que nunca se
 * ha visto fallar no es una comprobacion: es un adorno que sale verde.        */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const RAIZ = path.dirname(__dirname);
const PLANTAS = path.join(RAIZ, 'plantas');
const MODULOS = ['seguidor.js', 'equipos.js', 'sol.js', 'secc.json'];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/* EL VERIFICADOR, en una funcion aparte a proposito: asi la mutacion de abajo
   puede pasarle un contenido falso y comprobar que lo caza. Devuelve la lista
   de quejas — vacia es que todo cuadra. */
function verifica(proc, lee) {
  const quejas = [];
  /* Lo que DEBERIA estar cubierto: todos los layouts de `plantas/` y los cuatro
     modulos comunes. Se calcula del disco y no de PROCEDENCIA, o un fichero
     que alguien anadiera sin sincronizar pasaria invisible. */
  const enDisco = fs.readdirSync(PLANTAS).filter(f => f.endsWith('_layout.json'))
                    .map(f => 'plantas/' + f)
                    .concat(MODULOS.filter(m => fs.existsSync(path.join(RAIZ, m)))).sort();
  const listados = Object.keys(proc.ficheros || {}).sort();
  enDisco.forEach(f => { if (!listados.includes(f)) quejas.push(`${f} esta en el repo y no en PROCEDENCIA`); });
  listados.forEach(f => { if (!enDisco.includes(f)) quejas.push(`PROCEDENCIA lista ${f}, que no esta en el repo`); });
  listados.filter(f => enDisco.includes(f)).forEach(f => {
    const h = sha(lee(f));
    if (h !== proc.ficheros[f].sha256)
      quejas.push(`${f} no es el que se sincronizo (${h.slice(0, 12)} != ${proc.ficheros[f].sha256.slice(0, 12)})`);
  });
  return quejas;
}

const fProc = path.join(RAIZ, 'PROCEDENCIA.json');
check('PROCEDENCIA.json existe', fs.existsSync(fProc));
if (!fs.existsSync(fProc)) { console.log('1 FALLOS (' + ok + ' OK)'); process.exit(1); }
const proc = JSON.parse(fs.readFileSync(fProc, 'utf8'));

/* Sin el commit de origen, la procedencia es un adorno: no se puede volver al
   fichero del que salio esto. */
check('declara de que repo y de que commit salen',
      proc.fuente && proc.fuente.repo === 'IMoriana3/cobertura-zigbee'
        && /^[0-9a-f]{40}$/.test(proc.fuente.commit || ''),
      JSON.stringify(proc.fuente));

const listados = Object.keys(proc.ficheros || {});
check('cubre los layouts que sirve la pagina', listados.filter(f => f.startsWith('plantas/')).length >= 8,
      `${listados.filter(f => f.startsWith('plantas/')).length} layouts`);
/* LOS MODULOS SON LA MITAD QUE FALTABA. El gate nacio mirando solo los layouts,
   y mientras tanto `seguidor.js` —el modelo del seguidor, o sea la geometria de
   todo lo que esta pagina dibuja y apantalla— derivaba 59 lineas sin que nada
   chistara. Se exige que los cuatro esten. */
check('y los cuatro modulos comunes',
      MODULOS.every(m => listados.includes(m)),
      MODULOS.filter(m => !listados.includes(m)).join(' · ') || 'todos');

const lee = f => fs.readFileSync(path.join(RAIZ, f));
const quejas = verifica(proc, lee);
check('ningun fichero traido se ha tocado a mano desde la sincronizacion',
      quejas.length === 0, quejas.slice(0, 5).join(' · '));

/* Y que los layouts sigan siendo JSON legible, que el sha no lo garantiza. */
let malos = [];
Object.keys(proc.ficheros || {}).filter(f => f.startsWith('plantas/')).forEach(f => {
  try { const j = JSON.parse(lee(f));
        if (!Array.isArray(j.trackers) || !j.trackers.length) malos.push(f + ': sin seguidores'); }
  catch (e) { malos.push(f + ': ' + e.message); }
});
check('y los ocho layouts se abren y traen seguidores', malos.length === 0, malos.join(' · '));

/* Y QUE EL MODELO DEL SEGUIDOR SIGA SIENDO UN MODULO QUE CARGA. Un sha que casa
   no dice que el fichero sirva: podria haberse sincronizado uno truncado. */
let modOk = [];
MODULOS.filter(m => m.endsWith('.js')).forEach(m => {
  const t = lee(m).toString('utf8');
  if (!/VERSION\s*=/.test(t)) modOk.push(m + ': sin VERSION');
});
check('y los modulos declaran su version', modOk.length === 0, modOk.join(' · '));

/* ── LA MUTACION ─────────────────────────────────────────────────────────────
   Se le cambia UN numero a un layout, en memoria, y el verificador tiene que
   decir que no. Si esto saliera verde, el banco de arriba no estaria mirando
   nada. */
{
  const victima = Object.keys(proc.ficheros).find(f => f.startsWith('plantas/'));
  const tocado = f => f === victima
    ? Buffer.from(lee(f).toString('utf8').replace(/"clat":\s*[-\d.]+/, '"clat": 0.1'))
    : lee(f);
  const cambio = tocado(victima).toString() !== lee(victima).toString();
  check('la mutacion de prueba de verdad cambia el fichero', cambio, victima);
  check('un fichero editado a mano NO pasa el verificador',
        cambio && verifica(proc, tocado).some(q => q.startsWith(victima)),
        verifica(proc, tocado).join(' · ') || '(no se quejo de nada)');
}

if (ko) { console.log('\n' + ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
console.log('\nTODAS OK (' + ok + ' comprobaciones)');
