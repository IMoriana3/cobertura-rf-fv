/* ¿ES BUENO EL RELIEVE QUE USAN LAS PLANTAS SIN LEVANTAMIENTO?
 *
 *   node tests/test_careo_dem.js
 *
 * POR QUE IMPORTA. El simulador calcula MARGENES de cobertura, y el terreno los
 * cambia: con suelo plano un cerro que corta el enlace no existe y el margen
 * sale optimista. Seis plantas no tienen levantamiento y se apoyan en el DEM
 * (teselas Terrarium). Ese dato entro en el simulador declarando su procedencia
 * — y sin que nadie lo hubiera comprobado nunca contra una medida.
 *
 * COMO SE COMPRUEBA UN DATO ASI. Careandolo donde SI hay verdad: una planta con
 * levantamiento de topografo. Aqui son Ayora y San Jose (`CON_COTAS`); El Burgo
 * NO tiene levantamiento en este repo, aunque se diga a menudo lo contrario.
 * Ayora trae 754 seguidores con cota medida por sus dos extremos.
 *
 * QUE SE COMPARA. La cota del DEM contra `base + y` del levantamiento, en cada
 * extremo de cada viga. Entre un DEM global y un levantamiento hay siempre un
 * ESCALON sistematico —son referencias distintas—, asi que se mide (la mediana)
 * y se quita: lo que queda es el error de FORMA, que es el que decide si un
 * cerro tapa o no. Y por separado se carea el DESNIVEL total, que es la medida
 * mas directa de «reproduce este DEM el relieve de la planta».
 *
 * SIN RED. Las teselas no se bajan aqui: se versiona una rejilla de 30 m con su
 * procedencia (`fixtures/dem_ayora.json`, 81 KB) que regenera
 * `tools/baja_dem_ayora.py`. Versionar las 25 teselas serian 2 MB.
 *
 * LOS TOPES salen de la medida, no de un numero bonito, y con holgura:
 *   escalon  -0,47 m medido -> se exige |escalon| < 3
 *   p95       2,26 m        -> se exige < 4
 *   maximo    3,82 m        -> se exige < 8
 *   desnivel  91,2 contra 91,3 m -> se exige que no difieran mas del 10 %      */
const fs = require('fs'), path = require('path');
let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const RAIZ = path.dirname(__dirname);
const D = JSON.parse(fs.readFileSync(process.env.DEM_FIXTURE ||
  path.join(RAIZ, 'tests', 'fixtures', 'dem_ayora.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plantas', 'ayora_cotas.json'), 'utf8'));

/* Bilineal sobre la rejilla, igual que `cargaDEM` sobre el mosaico. */
function dem(x, n) {
  const fi = (x - D.x0) / D.paso, fj = (n - D.n0) / D.paso;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= D.nx || j0 + 1 >= D.nn) return null;
  const a = D.z[j0 * D.nx + i0], b = D.z[j0 * D.nx + i0 + 1];
  const c = D.z[(j0 + 1) * D.nx + i0], d = D.z[(j0 + 1) * D.nx + i0 + 1];
  const tx = fi - i0, ty = fj - j0;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

const med = [], dm = [];
for (const t of C.t) for (const f of t.f) for (const k of [0, 1]) {
  const q = dem(f.x, f.n[k]); if (q === null) continue;
  med.push(C.base + f.y[k]); dm.push(q);
}
/* SI NO CAE NINGUN PUNTO no se sigue. Una rejilla mal encuadrada —el caso de
   `dem()` devolviendo null en todo— dejaba las listas vacias y el banco moria
   con un volcado de pila en vez de decir que pasaba. Salia rojo, si, pero un
   banco tiene que DECIRLO. (Lo encontro su propia prueba de mutacion: correrlo
   con la rejilla desplazada 5 km al norte.) */
if (!med.length) {
  check('el careo tiene puntos que carear (los dos extremos de cada viga)', false,
        `ninguno: la rejilla (x0 ${D.x0}, n0 ${D.n0}, ${D.nx}x${D.nn} a ${D.paso} m) `
        + 'no cubre los seguidores de la planta');
  console.log(`\n${ko} comprobacion(es) con fallo`);
  process.exit(1);
}
const resid = med.map((m, i) => m - dm[i]);
const mediana = v => { const s = v.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const escalon = mediana(resid);
const forma = resid.map(r => Math.abs(r - escalon)).sort((a, b) => a - b);
const pc = q => forma[Math.floor(q * (forma.length - 1))];
const rango = v => Math.max(...v) - Math.min(...v);
const dnDEM = rango(dm), dnMed = rango(med);

console.log(`\n· El DEM contra el levantamiento de Ayora (${D.fuente})`);
console.log(`   ${med.length} puntos · escalon ${escalon.toFixed(2)} m`);
console.log(`   forma: p50 ${pc(.5).toFixed(2)} · p95 ${pc(.95).toFixed(2)} · max ${forma[forma.length-1].toFixed(2)} m`);
console.log(`   desnivel: DEM ${dnDEM.toFixed(1)} m · medido ${dnMed.toFixed(1)} m`);

/* Que haya puntos: una rejilla mal encuadrada devolveria null en todos y el
   resto de comprobaciones pasarian sobre listas vacias. */
check('el careo tiene puntos que carear (los dos extremos de cada viga)',
      med.length > 2500, med.length);
check('el escalon DEM-levantamiento es de referencia, no de relieve',
      Math.abs(escalon) < 3, escalon.toFixed(2) + ' m');
check('quitado el escalon, el 95 % del terreno cae dentro de 4 m',
      pc(.95) < 4, 'p95 ' + pc(.95).toFixed(2) + ' m');
check('y ni el peor punto se va de 8 m',
      forma[forma.length - 1] < 8, forma[forma.length - 1].toFixed(2) + ' m');
/* LA COMPROBACION QUE DE VERDAD IMPORTA para la cobertura: no la cota absoluta,
   sino cuanto sube y baja la planta. Un DEM desplazado no tapa enlaces; uno
   PLANO si los destapa. */
check('el DEM reproduce el DESNIVEL de la planta (menos del 10 % de error)',
      Math.abs(dnDEM - dnMed) / dnMed < 0.10,
      `${dnDEM.toFixed(1)} contra ${dnMed.toFixed(1)} m`);
check('la rejilla declara de donde sale', /Terrarium/.test(D.fuente || ''), D.fuente);

console.log(ko ? `\n${ko} comprobacion(es) con fallo` : '\nTODAS OK (' + ok + ' comprobaciones)');
process.exit(ko ? 1 : 0);
