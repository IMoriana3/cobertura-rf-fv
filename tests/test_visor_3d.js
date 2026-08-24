// El seguidor del visor RF — en un Chromium de verdad.
//
// El visor pasó de dibujar el seguidor como un rectángulo azul a pedírselo a
// `seguidor.js`, la fuente única de cotas que comparten el gemelo digital,
// Cobertura 3D y el simulador de backtracking. Un render bonito que no sea el
// MISMO seguidor del que habla la física es peor que el rectángulo: la imagen
// se lee como una prueba visual de un número que en realidad contradice.
//
// Por eso estas comprobaciones no miran píxeles: sacan las cotas de la ESCENA
// (matrices del mundo, no variables auxiliares) y las contrastan con las cotas
// del modelo y con las que usa el balance de enlace:
//
//   · la cara del módulo está a `DIMS.off` del eje del tubo — la misma cota que
//     entra en `lowerEdge()`, que es lo que decide la difracción;
//   · la antena cuelga del conector de la TCU y su elemento queda a la altura
//     `hA` con la que se calcula el margen, no a ojo;
//   · las tres antenas están separadas 2·paso EXACTOS (el enlace supone eso);
//   · es una BIFILA: solo la viga del motor lleva TCU y antena, y hay un eje de
//     transmisión por pareja — si esto falla, se está dibujando un campo de
//     monofilas con una TCU cada una, que es otra planta;
//   · el tilt del deslizador llega al modelo con el SIGNO bueno (canto bajo
//     hacia +X, igual que `moduleQuad` en la física);
//   · el deslizador de altura de módulo escala el MÓDULO, no el tubo;
//   · y la luz direccional tiene el frustum de sombra a escala del campo (el
//     ±5 m de fábrica de three deja la planta entera sin sombra).
//
//   python3 -m http.server 8099        (en otra terminal)
//   node tests/test_visor_3d.js
const { chromium } = require('playwright');

const URL  = process.env.URL || 'http://127.0.0.1:8099/index.html';
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
let ok = 0, ko = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

/* Sonda: todo sale de la escena. `spin` es el grupo que bascula; el `yaw` de la
   fila mapea el marco del modelo (+X = tubo) al de la escena (+Z = tubo). */
const SONDA = `(() => {
  const D = Seguidor.DIMS;
  const glassOf = beam => { let g = null; beam.traverse(n => {
    const p = n.geometry && n.geometry.parameters;
    if (!g && p && near(p.depth, D.modH - 0.04) && near(p.width, D.modW - 0.04)) g = n; }); return g; };
  function near(a,b){ return Math.abs(a-b) < 1e-6; }
  const g0 = glassOf(rows[0].spin);
  g0.updateWorldMatrix(true, false);
  const nrm = new THREE.Vector3(0,1,0).transformDirection(g0.matrixWorld);
  // TCU: caja de 0,50 × 0,26 × 0,36 del modelo, una por viga del motor
  const conTcu = rows.filter(r => { let f = false; r.spin.traverse(n => {
    const p = n.geometry && n.geometry.parameters;
    if (p && near(p.width,0.50) && near(p.height,0.26) && near(p.depth,0.36)) f = true; }); return f; }).length;
  const sc = sun.shadow.camera;
  let tube = null;
  rows[0].spin.traverse(n => { const p = n.geometry && n.geometry.parameters;
    if (!tube && p && near(p.height, D.tube) && near(p.depth, D.tube)) tube = n; });
  const A = rows.filter(r => r.ant).map(r => r.ant.pos.clone());
  let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
  return {
    version: Seguidor.VERSION, meshes,
    off: g0.position.y, glassScaleZ: g0.scale.z, tubeScaleZ: tube ? tube.scale.z : null,
    modW: D.modW, modH: D.modH, tubeSide: D.tube, off0: D.off,
    normal: nrm.toArray(), spinX: rows[0].spin.rotation.x,
    conTcu, ejes: pairs.length, filas: rows.length,
    ants: A.map(v => v.toArray()),
    antY: rows[1].ant.tip.position.y + rows[1].g.position.y,
    coaxVis: rows[1].ant.coax.visible,
    shadowR: sc.right, shadowFar: sc.far,
    span: SPAN(), pitch: P, htube: HTUBE, chord: CHORD, M0: M0,
    lowerEdge: lowerEdge(+document.getElementById('tilt').value),
    margen: linkMargin(+document.getElementById('tilt').value, Math.max(0.15, HTUBE - +document.getElementById('drop').value))
  };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  const set = (id, v) => page.evaluate(([id, v]) => {
    const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); }, [id, v]);

  /* ---- 1. el visor arranca y el seguidor es el del modelo, no cajas ---- */
  let s = await page.evaluate(SONDA);
  check('la escena carga sin errores de consola', errs.length === 0, errs.join(' | '));
  check('usa seguidor.js (la fuente única)', !!s.version, s.version);
  check('el seguidor va montado pieza a pieza (no un rectángulo)', s.meshes > 400, s.meshes + ' mallas');
  check('cotas canónicas del módulo (1,134 × 2,382)', near(s.modW, 1.134, 1e-9) && near(s.modH, 2.382, 1e-9), s.modW + '×' + s.modH);
  check('viga de torsión de 120 mm', near(s.tubeSide, 0.12, 1e-9), s.tubeSide);

  /* ---- 2. render y física, el MISMO seguidor ---- */
  check('la cara del módulo está a DIMS.off del eje del tubo', near(s.off, s.off0, 1e-6), s.off + ' vs ' + s.off0);
  check('la física usa esa misma cota (M0 = DIMS.off)', near(s.M0, s.off0, 1e-9), s.M0 + ' vs ' + s.off0);
  { // el canto bajo del módulo que apantalla el enlace, recalculado a mano
    const b = 30 * Math.PI / 180;
    const esperado = s.htube + s.off0 * Math.cos(b) - (s.chord / 2) * Math.abs(Math.sin(b));
    check('lowerEdge() sale de las cotas del modelo', near(s.lowerEdge, esperado, 1e-9), s.lowerEdge + ' vs ' + esperado);
  }

  /* ---- 3. la antena, donde dice el modelo ---- */
  check('la antena cuelga a la altura hA de la física', near(s.antY, s.htube - 0.72, 1e-6), s.antY);
  check('el coax se dibuja (el elemento queda bajo el conector)', s.coaxVis === true);
  check('tres antenas, en las filas pares', s.ants.length === 3, s.ants.length);
  {
    const d1 = Math.hypot(s.ants[1][0] - s.ants[0][0], s.ants[1][2] - s.ants[0][2]);
    const d2 = Math.hypot(s.ants[2][0] - s.ants[1][0], s.ants[2][2] - s.ants[1][2]);
    check('separadas 2·paso exactos (lo que supone el enlace)',
          near(d1, 2 * s.pitch, 1e-6) && near(d2, 2 * s.pitch, 1e-6), d1 + ' / ' + d2);
    check('las tres a la misma altura', near(s.ants[0][1], s.ants[2][1], 1e-9), s.ants.map(a => a[1]).join(' '));
  }

  /* ---- 4. es una bifila, no seis monofilas ---- */
  check('seis vigas', s.filas === 6, s.filas);
  check('solo tres llevan TCU (la del motor de cada pareja)', s.conTcu === 3, s.conTcu);
  check('un eje de transmisión por pareja', s.ejes === 3, s.ejes);

  /* ---- 5. el tilt llega al modelo, con su signo ---- */
  for (const beta of [30, -40, 0]) {
    await set('tilt', beta); await page.waitForTimeout(120);
    const t = await page.evaluate(SONDA);
    const r = beta * Math.PI / 180;
    check('tilt ' + beta + '°: el grupo que bascula gira lo pedido', near(t.spinX, r, 1e-6), t.spinX);
    // normal del módulo en el MUNDO: (sen β, cos β, 0) — el canto bajo cae hacia +X,
    // la misma convención que `moduleQuad` en la física del canvas original
    check('tilt ' + beta + '°: la normal del módulo apunta donde dice la física',
          near(t.normal[0], Math.sin(r), 1e-6) && near(t.normal[1], Math.cos(r), 1e-6) && near(t.normal[2], 0, 1e-6),
          t.normal.map(v => v.toFixed(4)).join(','));
  }
  await set('tilt', 30);

  /* ---- 6. la altura de módulo escala el MÓDULO, no el tubo ---- */
  await set('chord', 4.5); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('altura de módulo: el panel se escala', near(s.glassScaleZ, 4.5 / 2.382, 1e-3), s.glassScaleZ);
  check('altura de módulo: el tubo NO se escala', near(s.tubeScaleZ, 1, 1e-9), s.tubeScaleZ);
  await set('chord', 2.382);

  /* ---- 7. la sombra, a escala del campo ---- */
  await set('pitch', 15); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('el frustum de sombra cubre el campo (no el ±5 m de fábrica)',
        s.shadowR > (s.filas - 1) * s.pitch * 0.5, s.shadowR + ' m para un campo de ' + ((s.filas - 1) * s.pitch) + ' m');

  /* ---- 8. el tramo dibujado es el que se anuncia ---- */
  for (const [mods, largo] of [[7, 16.57], [28, 64.70]]) {
    await page.click('[data-m="' + mods + '"]'); await page.waitForTimeout(1200);
    const t = await page.evaluate(SONDA);
    check('tramo de ' + mods + ' módulos por ala = ' + largo + ' m', near(t.span, largo, 0.02), t.span);
  }

  check('sin errores de consola al final', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + ok + ' OK, ' + ko + ' FAIL');
  process.exit(ko ? 1 : 0);
})();
