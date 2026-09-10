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
 * COMO SE COMPRUEBA UN DATO ASI. Careandolo donde SI hay verdad: las plantas con
 * levantamiento de topografo, que son Ayora y San Jose (`CON_COTAS` en
 * index.html). El Burgo NO tiene levantamiento en este repo, aunque se diga a
 * menudo lo contrario. Dos plantas en dos continentes y dos hemisferios: si el
 * DEM se sostiene en las dos, no es casualidad de encuadre.
 *
 * QUE SE COMPARA. La cota del DEM contra `base + y` del levantamiento, en cada
 * extremo de cada viga. Entre un DEM global y un levantamiento hay siempre un
 * ESCALON —son referencias distintas, y en San Jose son 4 m—, asi que se mide
 * (la mediana) y se quita: queda el error de FORMA, que es el que decide si un
 * cerro tapa. Y por separado el DESNIVEL, que es la medida mas directa de
 * «reproduce este DEM el relieve de la planta».
 *
 * ESTADISTICA ROBUSTA, Y NO POR ELEGANCIA. El levantamiento de San Jose trae
 * ONCE COTAS IMPOSIBLES ya declaradas en este repo (37 m sobre sus vecinas). El
 * careo las reencuentra solo: su peor punto son 39,91 m. Si se midiera con
 * min-max y con el maximo, esas once mandarian sobre 8.744 puntos buenos. Se usa
 * p95/p99 y un desnivel de p1 a p99, y se ACOTA aparte cuantos puntos groseros
 * hay — que es declararlos, no taparlos.
 *
 * SIN RED. Las teselas no se bajan aqui: se versiona una rejilla de 30 m con su
 * procedencia (`fixtures/dem_<planta>.json`, ~90 KB) que regenera
 * `tools/baja_dem.py <planta>`. Las 41 teselas de las dos plantas serian 3 MB.
 *
 * LOS TOPES salen de la medida de las DOS plantas, con holgura, no de un numero
 * bonito:
 *              Ayora    San Jose   se exige
 *   escalon    -0,47      -4,20     |x| < 10   (es la referencia, no el relieve)
 *   p95         2,26       3,49          < 5
 *   p99         2,92       4,68          < 6
 *   groseros    0,00 %     0,33 %        < 1 %
 *   desnivel    0,3 %      1,4 %         < 5 %                                */
const fs = require('fs'), path = require('path');
let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const RAIZ = path.dirname(__dirname);
/* Una sola planta con `PLANTA=sanjose`, y la rejilla se puede sustituir con
   `DEM_FIXTURE` — asi se prueba por mutacion con un DEM falso. */
const SOLO = process.env.PLANTA;
const PLANTAS = SOLO ? [SOLO] : ['ayora', 'sanjose'];

const mediana = v => { const s = v.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const cuantil = (s, q) => s[Math.floor(q * (s.length - 1))];

for (const pl of PLANTAS) {
  const D = JSON.parse(fs.readFileSync(process.env.DEM_FIXTURE ||
    path.join(RAIZ, 'tests', 'fixtures', `dem_${pl}.json`), 'utf8'));
  const C = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plantas', `${pl}_cotas.json`), 'utf8'));

  /* Bilineal sobre la rejilla, igual que `cargaDEM` sobre el mosaico. */
  const dem = (x, n) => {
    const fi = (x - D.x0) / D.paso, fj = (n - D.n0) / D.paso;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    if (i0 < 0 || j0 < 0 || i0 + 1 >= D.nx || j0 + 1 >= D.nn) return null;
    const a = D.z[j0 * D.nx + i0], b = D.z[j0 * D.nx + i0 + 1];
    const c = D.z[(j0 + 1) * D.nx + i0], d = D.z[(j0 + 1) * D.nx + i0 + 1];
    const tx = fi - i0, ty = fj - j0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  /* El dato de San Jose viene con huecos DECLARADOS: 103 seguidores a null (los
     que no se levantaron) y filas sin cota. Se saltan: solo se carea donde hay
     medida. Contarlos y decirlos es parte del resultado. */
  const med = [], dm = []; let sinDato = 0;
  for (const t of C.t) {
    if (!t || !t.f) { sinDato++; continue; }
    for (const f of t.f) {
      if (!f || !f.y) continue;
      for (const k of [0, 1]) {
        if (f.y[k] == null) { sinDato++; continue; }
        const q = dem(f.x, f.n[k]); if (q === null) continue;
        med.push(C.base + f.y[k]); dm.push(q);
      }
    }
  }

  console.log(`\n· ${pl}: el DEM contra el levantamiento (${D.fuente})`);
  /* SI NO CAE NINGUN PUNTO no se sigue. Una rejilla mal encuadrada dejaba las
     listas vacias y el banco moria con un volcado de pila en vez de decir que
     pasaba. Salia rojo, si, pero un banco tiene que DECIRLO. (Lo encontro su
     propia prueba de mutacion, con la rejilla desplazada 5 km.) */
  if (!med.length) {
    check(`${pl}: el careo tiene puntos que carear`, false,
          `ninguno: la rejilla (x0 ${D.x0}, n0 ${D.n0}, ${D.nx}x${D.nn} a ${D.paso} m) `
          + 'no cubre los seguidores de la planta');
    continue;
  }

  const escalon = mediana(med.map((m, i) => m - dm[i]));
  const forma = med.map((m, i) => Math.abs(m - dm[i] - escalon)).sort((a, b) => a - b);
  const p95 = cuantil(forma, .95), p99 = cuantil(forma, .99);
  const groseros = forma.filter(v => v > 8).length, fracGro = groseros / forma.length;
  const banda = v => { const s = v.slice().sort((a, b) => a - b);
                       return cuantil(s, .99) - cuantil(s, .01); };
  const dnDEM = banda(dm), dnMed = banda(med);
  const errDn = Math.abs(dnDEM - dnMed) / dnMed;

  console.log(`   ${med.length} puntos careados · ${sinDato} sin cota medida (declarados) · escalon ${escalon.toFixed(2)} m`);
  console.log(`   forma: p50 ${cuantil(forma, .5).toFixed(2)} · p95 ${p95.toFixed(2)} · p99 ${p99.toFixed(2)} · peor ${forma[forma.length-1].toFixed(2)} m`);
  console.log(`   groseros (>8 m): ${groseros} = ${(100*fracGro).toFixed(2)} %`);
  console.log(`   desnivel (p1-p99): DEM ${dnDEM.toFixed(1)} m · medido ${dnMed.toFixed(1)} m (${(100*errDn).toFixed(1)} %)`);

  check(`${pl}: el careo tiene puntos que carear`, med.length > 2500, med.length);
  check(`${pl}: el escalon DEM-levantamiento es de referencia, no de relieve`,
        Math.abs(escalon) < 10, escalon.toFixed(2) + ' m');
  check(`${pl}: quitado el escalon, el 95 % del terreno cae dentro de 5 m`, p95 < 5, p95.toFixed(2));
  check(`${pl}: y el 99 %, dentro de 6`, p99 < 6, p99.toFixed(2));
  /* Los groseros de San Jose son sus cotas imposibles, ya declaradas en el repo.
     Se acota cuantos puede haber: si un dia son el 5 %, ya no es dato sucio
     conocido, es un DEM que no vale. */
  check(`${pl}: los puntos groseros son menos del 1 % (en San Jose, sus cotas imposibles)`,
        fracGro < 0.01, (100*fracGro).toFixed(2) + ' %');
  check(`${pl}: el DEM reproduce el DESNIVEL de la planta (menos del 5 % de error)`,
        errDn < 0.05, `${dnDEM.toFixed(1)} contra ${dnMed.toFixed(1)} m`);
  check(`${pl}: la rejilla declara de donde sale`, /Terrarium/.test(D.fuente || ''), D.fuente);
}

console.log(ko ? `\n${ko} comprobacion(es) con fallo` : `\nTODAS OK (${ok} comprobaciones)`);
process.exit(ko ? 1 : 0);
