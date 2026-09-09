// LA PRUEBA DE IMAGEN. Lo que los otros bancos no ven.
//
// POR QUÉ EXISTE, Y ES UNA LECCIÓN CARA. `test_visor_3d.js` y
// `test_bifila_plantas.js` comprueban geometría y cuentas: cotas, matrices,
// número de instancias, márgenes. Y aun así, cinco defectos seguidos llegaron
// a producción y los cazó el usuario mirando la pantalla:
//
//   · la TCU, el motor y el seccionador dibujados en las DOS vigas (430 donde
//     hay 215), que hacía que una planta bífila se viera igual que una monofila;
//   · el encuadre «Antena TCU» apuntando a un punto del corte de estudio;
//   · el terreno comiéndose las mesas, y luego con cornisas de 57 m;
//   · la pendiente de cada fila con el signo cambiado: un extremo 7 m al aire
//     y el otro 4 m bajo tierra, con el CENTRO bien — que era lo único que
//     miraba el banco;
//   · San José con monofilas que no existen.
//
// Todos eran VISIBLES y ninguno rompía una comprobación numérica. Cada uno se
// cerró con una comprobación nueva, pero el patrón dice que faltaba la clase
// entera: mirar el dibujo. Esto lo mira.
//
// CÓMO. Se renderiza un juego de vistas FIJAS y se comparan píxel a píxel con
// las imágenes de `tests/ref/`. No es un test de belleza: con la tolerancia de
// abajo, el ruido del antialiasing no lo mueve y un seguidor de más, una fila
// en otro sitio o un trozo de terreno donde no toca, sí.
//
// LAS REFERENCIAS SON UNA DECISIÓN, NO UN RESULTADO. Cada una es «esto es lo
// que se vio y se dio por bueno». Regenerarlas es un acto deliberado:
//
//     node tests/test_imagen.js --actualizar     (y MIRAR lo que sale antes de commitear)
//
// Si un cambio legítimo mueve una vista, se regenera y el diff de la imagen
// entra en el commit: quien lo revise ve exactamente qué cambió en pantalla.
//
//   python3 -m http.server 8099        (en otra terminal)
//   node tests/test_imagen.js
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.URL || 'http://127.0.0.1:8099/index.html';
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const REF = path.join(__dirname, 'ref');
const SALIDA = process.env.SALIDA || '/tmp/imagen-visor';
const ACTUALIZAR = process.argv.includes('--actualizar');
const W = 640, H = 360;

/* Tolerancia. Un píxel «distinto» es el que se sale de UMBRAL en algún canal;
   la vista falla si se salen más del MAX_PCT. Medido: con el azar sembrado
   (abajo), dos renders seguidos de la MISMA escena dan 0,016 % — veinte veces
   por debajo de la tolerancia—, y los defectos que se colaron mueven entre el
   5 y el 93 %. Hay sitio de sobra entre una cosa y la otra; el banco vigila
   ese margen y lo dice si se estrecha. */
const UMBRAL = 12, MAX_PCT = 0.35;

/* Y UNA SEGUNDA MEDIDA, POR BLOQUES, que es la que DECIDE. Motivo: el
   rasterizado por software (SwiftShader) despacha según las instrucciones del
   procesador, así que la misma escena en otra máquina —un runner de GitHub, el
   portátil de otro— puede mover píxeles sueltos en los bordes sin que nada
   haya cambiado en el dibujo. Comparar píxel a píxel ataría las referencias a
   ESTE ordenador. Promediando en bloques de 8x8 esas diferencias se van y lo
   que queda es la forma: un seguidor en otro sitio, el terreno donde no toca,
   un encuadre movido. La medida fina se sigue calculando y se sigue enseñando
   —y es la que pinta el diff— pero no es la que falla. */
const BLOQUE = 8, UMBRAL_B = 8, MAX_PCT_B = 1.0;

let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? '  -> ' + extra : '')); } };

/* SIN AZAR. La textura del suelo y la de las células se dibujan con
   `Math.random()`: sin fijarlo, dos ejecuciones de la MISMA escena dan
   imágenes distintas y la prueba no vale para nada. Se siembra un generador
   propio antes de que cargue la página. */
const SEMILLA = `(() => { let s = 20260908;
  Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
})()`;

/* El estado de TODOS los mandos, fijado: sol en manual, hora, día y latitud
   fijos (mandan en la luz y las sombras), patrón apagado y enlaces
   encendidos. Cualquiera que se deje suelto convierte la prueba en un
   generador de falsos fallos. */
const ESCENA = (ex) => `(() => {
  const v = Object.assign({ tilt: 25, drop: 0.72, pitch: 6, chord: 2.384, htube: 1.5,
              dncu: 12, hncu: 3.15, dhsu: 8, hora: 780, dia: 172, lat: 41.5 }, ${JSON.stringify(ex || {})});
  for (const k in v) { const e = document.getElementById(k); if (e) e.value = v[k]; }
  modoSol = false; playing = false;
  document.getElementById('pat').checked = false;
  document.getElementById('lnk').checked = true;
  document.getElementById('bt') && (document.getElementById('bt').checked = true);
  SOLO = null; VISTA = 'margen';
  document.querySelectorAll('#segd button').forEach(b => b.classList.toggle('on', b.dataset.d === 'man'));
  update();
})()`;

const VISTAS = [
  { n: 'corte-estudio', planta: '', cam: `frame('campo')` },
  { n: 'elburgo-conjunto', planta: 'elburgo', cam: `frame('campo')` },
  /* De cerca, palas PLANAS: a 25 grados la mesa se come el encuadre y la
     referencia no enseña el equipo que viene a vigilar. Y es además el caso
     del salto TCU-TCU, que pasa POR DEBAJO de la mesa. */
  { n: 'elburgo-antena', planta: 'elburgo', estado: { tilt: 0 }, cam: `frame('antena')` },
  { n: 'elburgo-gw-aislado', planta: 'elburgo', cam: `SOLO='2.1'; update(); frame('campo')` },
  /* POR DEBAJO DE LAS MESAS, A LO ANCHO DE LAS FILAS. Es la vista que faltaba:
     el primer defecto que se coló —una TCU y un motor en CADA viga, que hacía
     que un bífilo se viera como dos monofilas— no lo cazaba ninguna de las
     otras, porque a escala de planta una TCU es medio píxel y de cerca solo
     se ve una. Aquí se ven seis filas seguidas y CUÁLES llevan equipo: si
     aparece en todas, es que se ha vuelto a duplicar.
     La cámara va a la altura de la antena, desplazada PERPENDICULAR al tubo
     —(cos rot, −sin rot), la convención de `proj()`— para que valga también
     en una planta con el eje girado.

     Y UNA ADVERTENCIA HONESTA sobre esta prueba: una TCU es una caja de medio
     metro entre 430 filas, y NINGÚN encuadre la distingue por píxeles a esa
     escala (se ha probado, incluido de canto y desde debajo). Duplicarla NO
     rompe esta prueba: eso lo caza el RECUENTO DE INSTANCIAS de
     `test_bifila_plantas.js`, que es la herramienta para «cuántos hay». Esta
     prueba mira la FORMA de la escena: terreno, filas, encuadres, equipo a
     escala. Las dos juntas cubren los cinco defectos que se colaron; ninguna
     de las dos sola. */
  { n: 'elburgo-bajo-mesas', planta: 'elburgo', estado: { tilt: 0 }, cam: `(() => {
      const e = extentPlanta(), cn = -e.cz, TC = PLANTA._tcus;
      let best = TC[0], bd = 1e18;
      TC.forEach(T => { const d = Math.hypot(T.d.x - e.cx, T.d.n - cn); if (d < bd) { bd = d; best = T; } });
      const t = best.d, th = t.rot || 0, R = 34, S = 26;
      // perpendicular al tubo (cos, -sin) y A LO LARGO de el (sin, cos): en
      // diagonal se ven varias filas seguidas, y el accionamiento del propio
      // seguidor no tapa el encuadre
      const cx = t.x - R * Math.cos(th) + S * Math.sin(th);
      const cnn = t.n + R * Math.sin(th) + S * Math.cos(th);
      const hA = Math.max(0.15, HTUBE - (+document.getElementById('drop').value));
      camera.position.set(cx, t.y + hA + 0.35, -cnn);
      controls.target.set(t.x, t.y + hA, -t.n); controls.update();
    })()` },
  { n: 'ayora-fila-desnivel', planta: 'ayora', cam: `(() => {
      const F = PLANTA.cot.filas.slice().sort((a,b) => Math.abs(b.y1-b.y0) - Math.abs(a.y1-a.y0))[0];
      const g = cotaEn(F.x, F.n1);
      camera.position.set(F.x + 9, g + 2.2, -F.n1 - 12);
      controls.target.set(F.x, g + 1.2, -F.nm); controls.update();
    })()` },
  { n: 'sanjose-conjunto', planta: 'sanjose', cam: `frame('campo')` },
  { n: 'fayon-accionamiento', planta: 'fayon', estado: { tilt: 0 }, cam: `frame('motor')` },
  /* Y una a ras de suelo con las palas planas: es donde se vio que el terreno
     se comía las mesas y que los postes colgaban. */
  { n: 'ayora-fila-planas', planta: 'ayora', estado: { tilt: 0 }, cam: `(() => {
      const F = PLANTA.cot.filas.slice().sort((a,b) => Math.abs(b.y1-b.y0) - Math.abs(a.y1-a.y0))[0];
      const g = cotaEn(F.x, F.n1);
      camera.position.set(F.x + 9, g + 2.2, -F.n1 - 12);
      controls.target.set(F.x, g + 1.2, -F.nm); controls.update();
    })()` },
];

const foto = async (page) => Buffer.from((await page.evaluate(
  () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); })).split(',')[1], 'base64');

function compara(a, b) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { medida: true, pct: 100, pctB: 100, dif: null };
  const dif = new PNG({ width: A.width, height: A.height });
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i+1] - B.data[i+1]), Math.abs(A.data[i+2] - B.data[i+2]));
    const malo = d > UMBRAL; if (malo) n++;
    dif.data[i] = malo ? 255 : A.data[i] >> 2; dif.data[i+1] = malo ? 0 : A.data[i+1] >> 2;
    dif.data[i+2] = malo ? 255 : A.data[i+2] >> 2; dif.data[i+3] = 255;
  }
  // por bloques: media de cada bloque en las dos imágenes, y cuántos se mueven
  const bx = Math.ceil(A.width / BLOQUE), by = Math.ceil(A.height / BLOQUE);
  let nb = 0;
  for (let gy = 0; gy < by; gy++) for (let gx = 0; gx < bx; gx++) {
    let sa = [0, 0, 0], sb = [0, 0, 0], c = 0;
    for (let y = gy * BLOQUE; y < Math.min((gy + 1) * BLOQUE, A.height); y++)
      for (let x = gx * BLOQUE; x < Math.min((gx + 1) * BLOQUE, A.width); x++) {
        const i = (y * A.width + x) * 4;
        for (let k = 0; k < 3; k++) { sa[k] += A.data[i + k]; sb[k] += B.data[i + k]; }
        c++;
      }
    let peor = 0;
    for (let k = 0; k < 3; k++) peor = Math.max(peor, Math.abs(sa[k] - sb[k]) / c);
    if (peor > UMBRAL_B) nb++;
  }
  return { medida: false, pct: 100 * n / (A.width * A.height), pctB: 100 * nb / (bx * by), dif };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1'] });
  const page = await browser.newPage({ viewport: { width: W, height: H + 420 }, deviceScaleFactor: 1 });
  await page.addInitScript(SEMILLA);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  /* El lienzo, al tamaño EXACTO de la referencia: si la página lo estira con
     su propio diseño, la comparación mide el navegador, no el dibujo. */
  await page.evaluate(([w, h]) => { const c = document.getElementById('cv');
    c.style.width = w + 'px'; c.style.height = h + 'px'; c.parentElement.style.width = w + 'px';
    renderer.setPixelRatio(1); resize(); }, [W, H]);
  // el CAD llega por red: sin él la TCU es la caja del plan y la imagen es otra
  for (let i = 0; i < 60 && !(await page.evaluate(() => CAD.listo)); i++) await page.waitForTimeout(250);

  fs.mkdirSync(SALIDA, { recursive: true });
  let cargada = null;
  const ruido = [], ruidoFino = [];

  for (const v of VISTAS) {
    if (cargada !== v.planta) { await page.evaluate(p => cargaPlanta(p), v.planta);
      for (let i = 0; i < 300; i++) { if (await page.evaluate(p => !p || !!(PLANTA && PLANTA._un && PLANTA._un.length), v.planta)) break; await page.waitForTimeout(500); }
      cargada = v.planta; }
    await page.evaluate(ESCENA(v.estado));
    await page.evaluate(v.cam);
    await page.waitForTimeout(1200);
    const img = await foto(page);
    // ruido propio: dos renders de la MISMA escena
    const img2 = await foto(page);
    const rn = compara(img, img2); ruido.push(rn.pctB); ruidoFino.push(rn.pct);

    const ref = path.join(REF, v.n + '.png');
    if (ACTUALIZAR || !fs.existsSync(ref)) {
      fs.writeFileSync(ref, img);
      console.log((ACTUALIZAR ? 'ACTUALIZADA' : 'NUEVA      ') + '  ' + v.n);
      continue;
    }
    const r = compara(fs.readFileSync(ref), img);
    if (r.medida) { check(v.n + ': la vista mide lo que su referencia', false, 'tamaño distinto'); continue; }
    if (r.pctB > MAX_PCT_B) {
      fs.writeFileSync(path.join(SALIDA, v.n + '-ahora.png'), img);
      fs.writeFileSync(path.join(SALIDA, v.n + '-dif.png'), PNG.sync.write(r.dif));
    }
    check(v.n + ' se ve como su referencia (' + r.pctB.toFixed(2) + ' % de bloques · ' + r.pct.toFixed(2) + ' % de píxeles)',
          r.pctB <= MAX_PCT_B, r.pctB.toFixed(2) + ' % > ' + MAX_PCT_B + ' % de bloques · mira ' + SALIDA + '/' + v.n + '-dif.png');
  }

  /* Y QUE LA TOLERANCIA SIGA VALIENDO. Si el ruido propio del render se acerca
     a la tolerancia, la prueba deja de distinguir un defecto de un parpadeo y
     hay que enterarse ANTES de que empiece a fallar sola. */
  const peor = Math.max(...ruido), peorF = Math.max(...ruidoFino);
  check('el ruido del propio render queda MUY por debajo de la tolerancia (' +
        peor.toFixed(3) + ' % de bloques y ' + peorF.toFixed(3) + ' % de píxeles, frente a ' +
        MAX_PCT_B + ' %)', peor < MAX_PCT_B / 3, peor.toFixed(3));
  check('sin errores de JS en ninguna vista', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  console.log(ACTUALIZAR ? '\nReferencias actualizadas. MÍRALAS antes de commitear.'
              : (ko ? '\n' + ko + ' vista(s) cambiada(s). Compara en ' + SALIDA
                 : '\nTODAS OK (' + ok + ' comprobaciones)'));
  process.exit(ko ? 1 : 0);
})();
