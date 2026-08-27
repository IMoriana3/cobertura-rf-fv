// El visor RF — en un Chromium de verdad.
//
// El visor monta el seguidor con `seguidor.js`, la NCU y la HSU con
// `equipos.js`, y calcula con `web/zigbee_pv_model.js`, el núcleo del repo. Un
// render bonito que no sea el MISMO equipo del que habla la física es peor que
// un rectángulo: la imagen se lee como la prueba visual de un número que en
// realidad contradice.
//
// Por eso estas comprobaciones no miran píxeles: sacan las cotas de la ESCENA
// (matrices del mundo) y las contrastan con las de los modelos y con las que
// usa el balance de enlace:
//
//   · la cara del módulo está a `DIMS.off`, y esa misma cota es la que fija el
//     canto bajo de la mesa que apantalla;
//   · la antena de la TCU cuelga a la altura `hA` con la que se calcula;
//   · las tres TCU, separadas 2·paso EXACTOS (lo que supone el salto);
//   · es una BIFILA: tres TCU y tres ejes de transmisión, no seis monofilas;
//   · el tilt llega al modelo con el signo bueno;
//   · la NCU tiene el látigo a la cota de su plano (2,95 de poste + cabeza) y la
//     HSU a la del suyo, y las dos están EN EL MISMO CORTE que las TCU — si el
//     render las sacara de ese plano, el dibujo dejaría de ser el enlace que se
//     calcula;
//   · cada salto ve las mesas que le tocan: 1 el TCU↔TCU, y 4/2/0 los tres
//     TCU→NCU. Ahí se ve que un salto al coordinador CRUZA las filas y uno
//     entre vecinos pasa por debajo;
//   · el número que pinta la página es el que devuelve el núcleo, recalculado
//     aquí aparte;
//   · y el haz llega HASTA la otra antena (el cilindro continuo se quedaba a un
//     28 % de cerrar: el reparto de trazos se aplicaba también al tramo lleno).
//
//   python3 -m http.server 8099        (en otra terminal)
//   node tests/test_visor_3d.js
const { chromium } = require('playwright');

const URL  = process.env.URL || 'http://127.0.0.1:8099/index.html';
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
let ok = 0, ko = 0;
/* Estos botones no navegan a ningún sitio, pero Playwright espera igual a que
   «terminen las navegaciones programadas» — y esa espera necesita el hilo
   principal libre. El corte de 28 módulos tarda ~2,9 s por frame en software
   (2.805 llamadas de dibujo, casi todas de los módulos), así que la espera se
   agotaba sin que nada estuviera mal en la página.
   Y por lo mismo, 30 s no bastan para la comprobación de «estable», que se hace
   con requestAnimationFrame: con el hilo así de cargado, agotarla no dice nada
   de la página. 120 s. */
const CLIC = { noWaitAfter: true, timeout: 120000 };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

/* Sonda: todo sale de la escena. `spin` es el grupo que bascula; el `yaw` de la
   fila mapea el marco del modelo (+X = tubo) al de la escena (+Z = tubo). */
const SONDA = `(() => {
  const D = Seguidor.DIMS;
  function eq(a,b){ return Math.abs(a-b) < 1e-6; }
  const glassOf = beam => { let g = null; beam.traverse(n => {
    const p = n.geometry && n.geometry.parameters;
    if (!g && p && eq(p.depth, D.modH - 0.04) && eq(p.width, D.modW - 0.04)) g = n; }); return g; };
  const g0 = glassOf(rows[0].spin);
  g0.updateWorldMatrix(true, false);
  const nrm = new THREE.Vector3(0,1,0).transformDirection(g0.matrixWorld);
  /* "Esta viga lleva TCU" se mira por el SILLÍN de fijación (chapa 0,05 x 0,012
     x 0,21), que está tanto con la caja paramétrica como con el CAD real. Mirar
     la caja hacía que la comprobación dependiera de si el glb había llegado. */
  const conTcu = rows.filter(r => { let f = false; r.spin.traverse(n => {
    const p = n.geometry && n.geometry.parameters;
    if (p && eq(p.width,0.05) && eq(p.height,0.012) && eq(p.depth,0.21)) f = true; }); return f; }).length;
  const cad = { tcu: !!CAD.tcu, secc: !!CAD.secc, listo: CAD.listo,
    conn: CAD.conn ? CAD.conn.toArray() : null, ancla: ANCLA.toArray(),
    glb: (() => { let n = 0; rows.forEach(r => r.spin.traverse(o => {
           if (o.isMesh && o.material && /^mat_/.test(o.material.name || '')) n++; })); return n; })(),
    cajaTcu: (() => { let n = 0; rows.forEach(r => r.spin.traverse(o => {
           const q = o.geometry && o.geometry.parameters;
           if (q && eq(q.width,0.50) && eq(q.height,0.26) && eq(q.depth,0.36)) n++; })); return n; })(),
    seccStep: (() => { let n = 0; rows.forEach(r => r.spin.traverse(o => {
           if (o.geometry === CAD.secc) n++; })); return n; })() };
  const sc = sun.shadow.camera;
  let tube = null;
  rows[0].spin.traverse(n => { const p = n.geometry && n.geometry.parameters;
    if (!tube && p && eq(p.height, D.tube) && eq(p.depth, D.tube)) tube = n; });
  const A = rows.filter(r => r.ant).map(r => r.ant.pos.clone());
  let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });

  // el látigo de la NCU y los de la HSU, medidos en el MUNDO
  const bbTop = o => { const b = new THREE.Box3().setFromObject(o); return b.max.y; };
  const beta = BETA;          // el que manda: el deslizador solo cuando el modo es manual
  const hA = Math.max(0.15, HTUBE - +document.getElementById('drop').value);
  const band = ZigbeePV.tableBand(0, HTUBE, CHORD, beta, M0);

  // margen recalculado APARTE, contra el núcleo, para cada salto que pinta la página
  const p2 = params();
  const rec = [];
  for (let i = 0; i < A.length - 1; i++) {
    const ra = rows.filter(r=>r.ant)[i].row, rb = rows.filter(r=>r.ant)[i+1].row;
    const t = mesas(A[i].x, A[i+1].x, ra, rb, beta);
    const r0 = ZigbeePV.predictLink({x:A[i].x,y:0,ground:0,h:hA},
              {x:A[i+1].x,y:0,ground:0,h:hA}, p2, null, null, t);
    rec.push({ n:'tcu'+i, m: r0.marginDb, dif: r0.plDiffDb, mesas: t.length });
  }
  A.forEach((a,i) => {
    const ra = rows.filter(r=>r.ant)[i].row;
    const t = mesas(a.x, ncu.pos.x, ra, null, beta);
    const r1 = ZigbeePV.predictLink({x:a.x,y:0,ground:0,h:hA},
              {x:ncu.pos.x,y:0,ground:0,h:HNCU}, p2, null, null, t);
    rec.push({ n:'ncu'+i, m: r1.marginDb, dif: r1.plDiffDb, mesas: t.length });
  });

  // longitud REAL de los cilindros de enlace, sumada por pareja de extremos
  const solid = links.children.filter(c => c.material.depthTest !== false);
  const largo = solid.map(c => c.scale.y);

  return {
    version: Seguidor.VERSION, equipos: Equipos.VERSION, nucleo: typeof ZigbeePV, meshes,
    off: g0.position.y, glassScaleZ: g0.scale.z, tubeScaleZ: tube ? tube.scale.z : null,
    modW: D.modW, modH: D.modH, tubeSide: D.tube, off0: D.off,
    normal: nrm.toArray(), spinX: rows[0].spin.rotation.x,
    conTcu, ejes: pairs.length, filas: rows.length,
    ants: A.map(v => v.toArray()), antY: rows[1].ant.tip.position.y + rows[1].g.position.y,
    coaxVis: rows[1].ant.coax.visible,
    ncuPos: ncu.pos.toArray(), hsuPos: hsu.pos.toArray(),
    ncuTop: bbTop(ncu.g), hsuTop: bbTop(hsu.g),
    ncuCat: Equipos.ANT_H.ncu, hsuCat: Equipos.ANT_H.hsu, ZANT,
    band: { bot: band.bot, top: band.top, hw: band.hw },
    rec, largo, nSolid: solid.length,
    ghost: links.children.filter(c => c.material.depthTest === false).length,
    lect: [...document.querySelectorAll('#lect .l')].map(e => ({
      n: e.querySelector('.n').textContent, m: parseFloat(e.querySelector('.m').textContent),
      x: e.querySelector('.x').textContent })),
    cad,
    shadowR: sc.right, span: SPAN(), pitch: P, htube: HTUBE, chord: CHORD, M0: M0,
    hA, hncu: HNCU, dncu: DNCU,
    // el día
    beta: BETA, modoSol, sol: sunState(),
    sunY: sun.position.y, sunInt: sun.intensity, cielo: SKY.key,
    /* Dónde arranca el enlace, medido contra las PIEZAS: la distancia del
       extremo al látigo más cercano y al anemómetro. Es la comprobación que
       faltaba — el enlace salía en la coordenada buena pero visualmente parecía
       nacer del anemo, que está a la misma altura. */
    anclaje: (() => {
      const cerca = (p, g, pred) => { let d = 1e9;
        g.traverse(o => { if (!o.isMesh || !pred(o)) return;
          o.updateWorldMatrix(true, false);
          const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
          d = Math.min(d, c.distanceTo(p)); });
        return d; };
      const esLatigo = o => { const q = o.geometry.parameters;
        return q && q.radiusTop !== undefined && Math.abs(q.radiusTop - 0.005) < 1e-9; };
      const esAnemo = o => { const q = o.geometry.parameters;
        return q && q.radiusTop !== undefined && (Math.abs(q.radiusTop - 0.05) < 1e-9 || Math.abs(q.radiusTop - 0.045) < 1e-9); };
      return { hsuLatigo: cerca(hsu.pos, hsu.g, esLatigo), hsuAnemo: cerca(hsu.pos, hsu.g, esAnemo),
               ncuLatigo: cerca(ncu.pos, ncu.g, esLatigo) };
    })()
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
  /* El CAD (tcu.glb + secc.json) llega por red y la escena se rehace al
     llegar. Sin esperarlo, medio banco saldría distinto según la carga. */
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => typeof CAD !== 'undefined' && CAD.listo)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);

  const set = (id, v) => page.evaluate(([id, v]) => {
    const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); }, [id, v]);

  /* ---- 1. arranque: los tres modelos, y la física en el núcleo del repo ---- */
  let s = await page.evaluate(SONDA);
  check('la escena carga sin errores de consola', errs.length === 0, errs.join(' | '));
  check('usa seguidor.js (la fuente única del seguidor)', !!s.version, s.version);
  check('usa equipos.js (NCU y HSU)', !!s.equipos, s.equipos);
  check('la física la pone el núcleo del repo, no la página', s.nucleo === 'object', s.nucleo);
  check('el seguidor va montado pieza a pieza (no un rectángulo)', s.meshes > 400, s.meshes + ' mallas');
  check('cotas canónicas del módulo (1,134 × 2,382)', near(s.modW, 1.134, 1e-9) && near(s.modH, 2.382, 1e-9), s.modW + '×' + s.modH);
  check('viga de torsión de 120 mm', near(s.tubeSide, 0.12, 1e-9), s.tubeSide);

  /* ---- 2. render y física, el MISMO seguidor ---- */
  check('la cara del módulo está a DIMS.off del eje del tubo', near(s.off, s.off0, 1e-6), s.off + ' vs ' + s.off0);
  check('la física usa esa misma cota (M0 = DIMS.off)', near(s.M0, s.off0, 1e-9), s.M0 + ' vs ' + s.off0);
  { // el canto bajo de la mesa que apantalla, recalculado a mano con el ángulo vigente
    const b = Math.abs(s.beta) * Math.PI / 180;   // la banda es simétrica: `tableBand` usa |tilt|
    const bot = s.htube + s.off0 * Math.cos(b) - (s.chord / 2) * Math.sin(b);
    const top = s.htube + s.off0 * Math.cos(b) + (s.chord / 2) * Math.sin(b);
    check('la mesa es una PLACA entre dos cotas, no un muro',
          near(s.band.bot, bot, 1e-9) && near(s.band.top, top, 1e-9), s.band.bot + ' / ' + s.band.top);
    check('la antena de la TCU queda POR DEBAJO del canto bajo', s.hA < s.band.bot, s.hA + ' < ' + s.band.bot);
    check('la antena de la NCU queda POR ENCIMA de la cresta', s.hncu > s.band.top, s.hncu + ' > ' + s.band.top);
  }

  /* ---- 3. las tres antenas de TCU ---- */
  check('la antena de la TCU cuelga a la altura hA de la física', near(s.antY, s.htube - 0.72, 1e-6), s.antY);
  check('el coax se dibuja (el elemento queda bajo el conector)', s.coaxVis === true);
  check('tres TCU con antena, en las filas pares', s.ants.length === 3, s.ants.length);
  {
    const d1 = Math.hypot(s.ants[1][0] - s.ants[0][0], s.ants[1][2] - s.ants[0][2]);
    const d2 = Math.hypot(s.ants[2][0] - s.ants[1][0], s.ants[2][2] - s.ants[1][2]);
    check('separadas 2·paso exactos (lo que supone el salto)',
          near(d1, 2 * s.pitch, 1e-6) && near(d2, 2 * s.pitch, 1e-6), d1 + ' / ' + d2);
  }

  /* ---- 4. es una bifila, no seis monofilas ---- */
  check('seis vigas', s.filas === 6, s.filas);
  check('solo tres llevan TCU (la del motor de cada pareja)', s.conTcu === 3, s.conTcu);
  check('un eje de transmisión por pareja', s.ejes === 3, s.ejes);

  /* ---- 5. NCU y HSU: cotas de plano y en el corte de la física ---- */
  check('la antena de la NCU, a la cota de su plano', near(s.ncuPos[1], s.ncuCat, 1e-9), s.ncuPos[1] + ' vs ' + s.ncuCat);
  check('la antena de la HSU, a la cota de montaje (6,50 m, en su brazo)',
        near(s.hsuPos[1], s.hsuCat, 1e-9) && near(s.hsuCat, 6.50, 1e-9), s.hsuPos[1] + ' vs ' + s.hsuCat);
  check('los látigos de la HSU NO están en la cabeza, junto al ultrasónico',
        s.hsuTop - s.hsuPos[1] > 1.5, 'cabeza ' + s.hsuTop.toFixed(2) + ', antena ' + s.hsuPos[1]);
  check('el poste de la NCU llega a su cabeza (2,95 + látigo)', s.ncuTop > 3.3 && s.ncuTop < 3.5, s.ncuTop);
  check('la torre de la HSU llega a sus 8 m + cabeza', s.hsuTop > 8.4 && s.hsuTop < 8.7, s.hsuTop);
  check('NCU y HSU van en el MISMO corte que las TCU',
        near(s.ncuPos[2], s.ZANT, 1e-9) && near(s.hsuPos[2], s.ZANT, 0.13),
        s.ncuPos[2] + ' / ' + s.hsuPos[2] + ' vs ' + s.ZANT);
  check('la NCU está fuera del campo, al lado que dice el mando',
        near(s.ncuPos[0], (s.filas - 1) * s.pitch + s.dncu, 0.1), s.ncuPos[0]);

  /* ---- 6. qué mesas ve cada salto ---- */
  {
    const m = Object.fromEntries(s.rec.map(r => [r.n, r.mesas]));
    check('TCU↔TCU cruza UNA fila intermedia', m.tcu0 === 1 && m.tcu1 === 1, JSON.stringify(m));
    check('TCU→NCU cruza las filas que quedan en medio (4/2/0)',
          m.ncu0 === 4 && m.ncu1 === 2 && m.ncu2 === 0, JSON.stringify(m));
  }

  /* ---- 7. el número pintado es el del núcleo ---- */
  {
    const pintado = s.lect.map(l => l.m);
    const calc = s.rec.map(r => +r.m.toFixed(1));
    check('los 5 primeros márgenes de la tabla salen del núcleo',
          calc.every((v, i) => near(v, pintado[i], 0.051)),
          JSON.stringify(calc) + ' vs ' + JSON.stringify(pintado.slice(0, calc.length)));
    check('el salto entre vecinos es holgado y el más lejano a la NCU, el peor',
          pintado[0] > pintado[2] && pintado[2] < pintado[4], JSON.stringify(pintado));
    check('la tabla lista los 6 saltos (2 TCU↔TCU + 3 →NCU + HSU)', s.lect.length === 6, s.lect.length);
  }

  /* ---- 8. el haz llega hasta la otra antena ---- */
  {
    const d = Math.hypot(s.ants[1][0] - s.ants[0][0], s.ants[1][1] - s.ants[0][1], s.ants[1][2] - s.ants[0][2]);
    const cierra = s.largo.some(L => near(L, d, 1e-6));
    check('el cilindro del enlace cubre el vano ENTERO (no el 72 %)', cierra,
          'vano ' + d.toFixed(3) + ', cilindros ' + s.largo.map(v => v.toFixed(2)).join(','));
    check('cada enlace lleva su fantasma sin test de profundidad', s.ghost === s.nSolid,
          s.ghost + ' vs ' + s.nSolid);
  }

  /* ---- 9. el tilt llega al modelo, con su signo (en manual: con el sol lo manda la hora) ---- */
  await page.click('[data-d="man"]', CLIC); await page.waitForTimeout(150);
  for (const beta of [30, -40, 0]) {
    await set('tilt', beta); await page.waitForTimeout(120);
    const t = await page.evaluate(SONDA);
    const r = beta * Math.PI / 180;
    check('tilt ' + beta + '°: el grupo que bascula gira lo pedido', near(t.spinX, r, 1e-6), t.spinX);
    check('tilt ' + beta + '°: la normal del módulo apunta donde dice la física',
          near(t.normal[0], Math.sin(r), 1e-6) && near(t.normal[1], Math.cos(r), 1e-6) && near(t.normal[2], 0, 1e-6),
          t.normal.map(v => v.toFixed(4)).join(','));
  }
  await set('tilt', 30);
  await page.click('[data-d="sol"]', CLIC); await page.waitForTimeout(150);

  /* ---- 10. los mandos de NCU/HSU mueven la escena Y el cálculo ---- */
  await set('dncu', 60); await page.waitForTimeout(200);
  {
    const t = await page.evaluate(SONDA);
    check('alejar la NCU la mueve en la escena', near(t.ncuPos[0], (t.filas - 1) * t.pitch + 60, 0.1), t.ncuPos[0]);
    const dist = x => parseFloat(/·\s*([\d.]+) m/.exec(x)[1]);
    check('alejar la NCU alarga el salto', dist(t.lect[4].x) > dist(s.lect[4].x) + 40,
          dist(s.lect[4].x) + ' m -> ' + dist(t.lect[4].x) + ' m');
  }
  await set('dncu', 12); await page.waitForTimeout(200);
  /* El MECANISMO, no el total: subir la antena de la NCU por encima de la cresta
     hace que el rayo deje de pasar por debajo de las mesas y empiece a cruzarlas,
     así que la DIFRACCIÓN crece de forma limpia (14,5 -> 43,9 dB en el barrido).
     El margen no es monótono, y eso también es física: el modelo de dos rayos
     mete sus nulos de interferencia por el camino. Se comprueba lo primero. */
  {
    /* Con el ángulo que toque a esa hora la banda puede ser fina y el contraste
       se estrecha. La afirmación es sobre la geometría de referencia (30°), así
       que se fija a mano y se devuelve el mando al sol al terminar. */
    await page.click('[data-d="man"]', CLIC); await set('tilt', 30); await page.waitForTimeout(150);
    const alto = await page.evaluate(SONDA);           // 3,15 m: por encima de la cresta
    await set('hncu', 1.0); await page.waitForTimeout(200);
    const bajo = await page.evaluate(SONDA);           // 1,00 m: por debajo del canto bajo
    const dA = alto.rec.find(r => r.n === 'ncu0').dif, dB = bajo.rec.find(r => r.n === 'ncu0').dif;
    check('la NCU por encima de la cresta CRUZA las mesas: más difracción', dA > dB + 10,
          'difr. ' + dA.toFixed(1) + ' dB a ' + alto.hncu + ' m vs ' + dB.toFixed(1) + ' dB a ' + bajo.hncu + ' m');
    check('el salto más corto a la NCU no cruza ninguna mesa: difracción 0',
          near(alto.rec.find(r => r.n === 'ncu2').dif, 0, 1e-9), alto.rec.find(r => r.n === 'ncu2').dif);
  }
  await set('hncu', 3.15); await page.click('[data-d="sol"]', CLIC); await page.waitForTimeout(200);

  /* ---- 11. altura de módulo: escala el MÓDULO, no el tubo ---- */
  await set('chord', 4.5); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('altura de módulo: el panel se escala', near(s.glassScaleZ, 4.5 / 2.382, 1e-3), s.glassScaleZ);
  check('altura de módulo: el tubo NO se escala', near(s.tubeScaleZ, 1, 1e-9), s.tubeScaleZ);
  await set('chord', 2.382);

  /* ---- 12. la sombra, a escala del campo ---- */
  await set('pitch', 15); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('el frustum de sombra cubre el campo (no el ±5 m de fábrica)',
        s.shadowR > (s.filas - 1) * s.pitch * 0.5, s.shadowR + ' m para un campo de ' + ((s.filas - 1) * s.pitch) + ' m');
  await set('pitch', 6);

  /* ---- 13. el tramo dibujado es el que se anuncia ---- */
  for (const [mods, largo] of [[7, 16.57], [28, 64.70]]) {
    await page.click('[data-m="' + mods + '"]'); await page.waitForTimeout(1200);
    const t = await page.evaluate(SONDA);
    check('tramo de ' + mods + ' módulos por ala = ' + largo + ' m', near(t.span, largo, 0.02), t.span);
  }

  /* ---- 14. la señal va de ANTENA a ANTENA, no del anemómetro ---- */
  await page.click('[data-m="7"]', CLIC); await page.waitForTimeout(1200);
  s = await page.evaluate(SONDA);
  check('el enlace de la HSU arranca EN el látigo', s.anclaje.hsuLatigo < 0.06, s.anclaje.hsuLatigo);
  check('y no en el anemómetro ultrasónico, que está a la misma altura',
        s.anclaje.hsuAnemo > 0.15, s.anclaje.hsuAnemo);
  check('el enlace de la NCU arranca EN su látigo', s.anclaje.ncuLatigo < 0.06, s.anclaje.ncuLatigo);

  /* ---- 14b. la TCU y el seccionador son los MISMOS que en los 3D ---- */
  check('carga el CAD real de la TCU (tcu.glb)', s.cad.tcu === true);
  check('carga la malla del STEP del seccionador (secc.json)', s.cad.secc === true);
  check('las tres vigas del motor montan las 17 primitivas del glb',
        s.cad.glb === 3 * 17, s.cad.glb);
  check('y ya no queda ninguna caja paramétrica de TCU', s.cad.cajaTcu === 0, s.cad.cajaTcu);
  /* Tres, no seis: el seccionador DC va SOLO en la viga del motor, junto a la
     TCU (`SOLO_OESTE` en seguidor.js). La gemela lleva el eje de transmisión y
     punto. */
  check('el seccionador de las tres vigas del motor usa la malla del STEP',
        s.cad.seccStep === 3, s.cad.seccStep);
  {
    /* El coax sale del conector DORADO real del glb, no de la estimación que
       había (tcuX − 0,16, −0,225). Y lo que entra en la física —la ALTURA del
       elemento— la sigue fijando el deslizador de caída: cambia el punto de
       salida, no la cota. */
    check('el coax sale del conector dorado del CAD, no de la estimación',
          s.cad.conn !== null && Math.abs(s.cad.ancla[1] + 0.225) > 0.02,
          'ancla ' + s.cad.ancla.map(v => v.toFixed(3)).join(','));
    check('y la altura de la antena la sigue fijando la caída (la física no se mueve)',
          near(s.antY, s.htube - 0.72, 1e-6), s.antY);
    const d1 = Math.hypot(s.ants[1][0] - s.ants[0][0], s.ants[1][2] - s.ants[0][2]);
    check('las tres antenas siguen separadas 2·paso exactos', near(d1, 2 * s.pitch, 1e-6), d1);
  }

  /* ---- 15. el día: el seguidor se mueve con el sol ---- */
  const enHora = async (min) => { await set('hora', min); await page.waitForTimeout(150);
                                  return page.evaluate(SONDA); };
  {
    await set('dia', 172); await set('lat', 41.5);     // 21 de junio
    const alba = await enHora(420), medio = await enHora(720), tarde = await enHora(1020);
    check('a mediodía el seguidor está casi plano', Math.abs(medio.beta) < 2, medio.beta);
    check('por la mañana mira al ESTE (θ > 0, el canto bajo al este)', alba.beta > 20, alba.beta);
    check('por la tarde mira al OESTE (θ < 0)', tarde.beta < -20, tarde.beta);
    check('el sol sube y baja de verdad', alba.sol.elev < medio.sol.elev && tarde.sol.elev < medio.sol.elev,
          [alba.sol.elev, medio.sol.elev, tarde.sol.elev].map(v => v.toFixed(1)).join(' / '));
    check('la luz sigue al sol (más alta a mediodía)', medio.sunY > alba.sunY, medio.sunY.toFixed(1) + ' vs ' + alba.sunY.toFixed(1));
    check('el cielo se repinta con la hora', alba.cielo !== medio.cielo, alba.cielo + ' | ' + medio.cielo);

    /* Lo que hace útil el día: con las palas DE CANTO la banda de la mesa es un
       muro y el salto al coordinador se cae; con las palas planas, casi no
       apantalla. El peor rato no es la noche, es el alba. */
    /* Medido CONTRA el salto entre vecinos de la misma hora, no en dB absolutos:
       lo que se afirma es que la mesa apantalla, y eso no puede depender de si
       el modelo va calibrado —la calibración es un sesgo global de −33,6 dB y se
       le resta igual a los dos extremos—. Escrito en absoluto, este par se caía
       al calibrar sin que nada de la física hubiera cambiado. */
    const mAlba = alba.lect[2].m, mMedio = medio.lect[2].m;
    const vAlba = alba.lect[0].m, vMedio = medio.lect[0].m;
    check('con las palas de canto el salto a la NCU se cae', mAlba < vAlba - 20,
          mAlba + ' dB contra ' + vAlba + ' del salto entre vecinos');
    check('con las palas planas el mismo salto va holgado', mMedio > mAlba + 15,
          mMedio + ' dB contra ' + mAlba + ' al alba');
    /* El salto entre vecinos aguanta el día entero. Ojo: NO siempre "pasa por
       debajo" — con las palas muy de canto el borde bajo cae por debajo de la
       antena y hasta ese salto empieza a cruzar mesa. Lo que se sostiene es que
       aguanta, porque roza el borde en vez de atravesar la banda entera. */
    /* «Aguanta» = por encima del umbral de 8 dB con el que la página pinta en
       rojo, a las dos horas. En absoluto (>40) esto medía el modelo, no el salto. */
    check('el salto entre vecinos aguanta a las dos horas',
          vAlba > 8 && vMedio > 8, vAlba + ' / ' + vMedio);
    check('a mediodía la antena de la TCU sí queda bajo el canto de la mesa',
          medio.hA < medio.band.bot, medio.hA + ' vs ' + medio.band.bot);

    const noche = await enHora(60);
    check('de noche los seguidores duermen en stow (5° al este)', Math.abs(noche.beta - 5) < 1e-6, noche.beta);
    check('de noche la luz se apaga', noche.sunInt < 0.05, noche.sunInt);
  }

  /* ---- 16. backtracking: entra cuando hay sombra de fila que evitar ---- */
  {
    await set('hora', 420);
    await set('pitch', 3); await page.waitForTimeout(200);      // GCR 0,79: las filas se pisan
    const apretado = await page.evaluate(SONDA);
    const wid = await page.evaluate(() => Sol.trueTrackAngle(90 - sunState().elev, sunState().az, 0, 0));
    check('a paso corto el backtracking recoge el seguidor por debajo del astronómico',
          apretado.beta < wid - 5, 'θ ' + apretado.beta.toFixed(1) + '° vs astronómico ' + wid.toFixed(1) + '°');
    await page.evaluate(() => { const e = document.getElementById('bt'); e.checked = false; e.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(200);
    const sinBt = await page.evaluate(SONDA);
    check('sin backtracking el seguidor se va al astronómico (o a su tope)',
          sinBt.beta > apretado.beta + 5, sinBt.beta.toFixed(1) + ' vs ' + apretado.beta.toFixed(1));
    await page.evaluate(() => { const e = document.getElementById('bt'); e.checked = true; e.dispatchEvent(new Event('change')); });
    await set('pitch', 6);
  }

  /* ---- 17. el mando manual sigue mandando ---- */
  await page.click('[data-d="man"]', CLIC); await page.waitForTimeout(150);
  await set('tilt', -33); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('en manual el ángulo es el del deslizador', near(s.beta, -33, 1e-9), s.beta);
  check('en manual el deslizador NO está bloqueado',
        await page.evaluate(() => !document.getElementById('tilt').disabled));
  await page.click('[data-d="sol"]', CLIC); await page.waitForTimeout(150);
  check('con el sol, el deslizador se bloquea (lo manda la hora)',
        await page.evaluate(() => document.getElementById('tilt').disabled));

  /* ---- 18. planta real: layout, equipos donde dice el DWG y colocación ---- */
  await page.click('[data-p="fayon"]', CLIC); await page.waitForTimeout(2500);
  {
    const t = await page.evaluate(() => ({
      trk: PLANTA.trk.length, ncus: PLANTA.ncus.length, hsus: PLANTA.meteo.length,
      eq: PLEQ.length, inst: PLI.length,
      pos: PLEQ.map(e => [e.tipo, +e.g.position.x.toFixed(2), +(-e.g.position.z).toFixed(2)]),
      lect: [...document.querySelectorAll('#lect .m')].map(e => e.textContent) }));
    check('carga el layout de la planta', t.trk === 24 && t.ncus === 1 && t.hsus === 1,
          JSON.stringify([t.trk, t.ncus, t.hsus]));
    check('los equipos van en su coordenada del DWG',
          Math.abs(t.pos[0][1] - 50.49) < 0.01 && Math.abs(t.pos[0][2] - (-44.25)) < 0.01, JSON.stringify(t.pos));
    check('los seguidores se dibujan instanciados (un mesh por tipo de pieza)', t.inst > 4, t.inst);
    /* Tres filas de resumen + UNA POR (NCU,GW): Fayón tiene un solo grupo, así
       que son cuatro. El ámbito no es la planta, es el gateway. */
    check('la lectura resume la planta y desglosa por gateway', t.lect.length === 4, t.lect.join(' / '));
  }
  {
    /* Colocar a mano: arrastre y casillas son el MISMO camino, y mover la NCU
       tiene que mover el resultado — si no, el mando no está conectado. */
    const antes = await page.evaluate(() => parseFloat(document.querySelector('#lect .m').textContent));
    await page.evaluate(() => { const e = PLEQ.find(q => q.tipo === 'ncu'); mueveEquipo(e, e.dato.x - 300, e.dato.n + 200); update(); });
    await page.waitForTimeout(800);
    const t = await page.evaluate(() => ({
      m: parseFloat(document.querySelector('#lect .m').textContent),
      x: +document.getElementById('ncuX').value, n: +document.getElementById('ncuN').value,
      px: +PLEQ.find(q => q.tipo === 'ncu').g.position.x.toFixed(2) }));
    /* OJO: NO se exige que alejarla empeore. Con suelo perfecto el rizado de dos
       rayos hace que alejar un equipo pueda MEJORAR el margen — esta misma
       comprobación lo cazó (17,5 -> 18,7 dB al irse 360 m). Lo que se exige aquí
       es que el mando esté CONECTADO: mover la NCU mueve el resultado. La caída
       monotona con la distancia se comprueba abajo, con tierra real, que es
       donde el rizado no la tapa. */
    check('mover la NCU mueve la cobertura de la planta', Math.abs(t.m - antes) > 0.5, antes + ' -> ' + t.m);
    check('las casillas siguen al arrastre', Math.abs(t.x - t.px) < 0.11, t.x + ' vs ' + t.px);
    await page.evaluate(() => { const e = document.getElementById('ncuX'); e.value = 50.5; e.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(600);
    const v = await page.evaluate(() => +PLEQ.find(q => q.tipo === 'ncu').g.position.x.toFixed(2));
    check('y escribir la coordenada mueve el equipo', Math.abs(v - 50.5) < 0.01, v);
    // con TIERRA REAL, sin el rizado por medio, alejarla sí empeora
    await page.click('[data-g="real"]', CLIC); await page.waitForTimeout(600);
    const cerca = await page.evaluate(() => parseFloat(document.querySelector('#lect .m').textContent));
    await page.evaluate(() => { const e = PLEQ.find(q => q.tipo === 'ncu'); mueveEquipo(e, e.dato.x - 600, e.dato.n); update(); });
    await page.waitForTimeout(800);
    const lejos = await page.evaluate(() => parseFloat(document.querySelector('#lect .m').textContent));
    check('con tierra real, alejar la NCU 600 m SÍ empeora', lejos < cerca - 5, cerca + ' -> ' + lejos);
    await page.click('[data-g="pec"]', CLIC); await page.waitForTimeout(300);
  }

  /* ---- 18b. Ayora con las cotas MEDIDAS ---- */
  await page.evaluate(() => cargaPlanta('ayora'));
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => PLANTA && PLANTA.cot && (PLANTA._un || []).length > 0)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
  {
    const t = await page.evaluate(() => {
      const U = PLANTA._un || [], y = U.map(u => u.y), tl = U.map(u => Math.abs(u.tilt));
      return { cot: !!PLANTA.cot, filas: PLANTA.cot.filas.length, un: U.length,
               ymin: Math.min.apply(null, y), ymax: Math.max.apply(null, y),
               pmax: Math.max.apply(null, tl) * 180 / Math.PI,
               terreno: !!terreno,
               eqY: PLEQ.map(e => e.g.position.y),
               sin: parseInt([...document.querySelectorAll('#lect .m')][2].textContent, 10) };
    });
    check('Ayora trae sus cotas medidas', t.cot === true);
    /* Con cotas la unidad pasa a ser la FILA: un bifila son dos, y el layout
       solo daba una posición por unidad. 754 seguidores -> 1.508 filas. */
    check('con cotas se dibuja FILA a fila (1.508, no 754)', t.filas === 1508 && t.un === 1508,
          t.filas + ' / ' + t.un);
    check('las filas van a su cota medida (91 m de desnivel)', t.ymax - t.ymin > 80,
          t.ymin.toFixed(1) + ' … ' + t.ymax.toFixed(1) + ' m');
    check('y con su pendiente N-S, que no es cero', t.pmax > 2, t.pmax.toFixed(2) + '°');
    check('el terreno se dibuja con el relieve medido', t.terreno === true);
    check('los equipos se apoyan en el terreno, no en el cero',
          t.eqY.some(v => Math.abs(v) > 1), t.eqY.slice(0, 3).map(v => v.toFixed(1)).join(','));
    /* Lo que justifica meterlas: en plano salían 16 filas por debajo de 8 dB;
       con el relieve real son muchas más. El terreno no es decoración. */
    check('el relieve cambia el resultado, y mucho', t.sin > 60, t.sin + ' filas por debajo de 8 dB');
  }
  await page.click('[data-p=""]', CLIC); await page.waitForTimeout(1200);

  /* ---- 18c. San José: 32 módulos por ala, huecos del levantamiento y sur ---- */
  await page.evaluate(() => cargaPlanta('sanjose'));
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!(PLANTA && PLANTA._un && PLANTA._un.length))) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
  {
    const t = await page.evaluate(() => {
      const U = PLANTA._un || [], med = U.filter(u => u.med);
      return { mods: PLANTA.mods, trk: PLANTA.trk.length, filas: PLANTA.cot.filas.length,
               sin: PLANTA.cot.sinCota.length, un: U.length,
               largo: med.reduce((s, u) => s + u.mr, 0) / med.length * SPANP,
               lat: +document.getElementById('lat').value };
    });
    check('San José son 32 módulos por ala, no los 28 de El Burgo', t.mods === 32, t.mods);
    check('y sus filas miden ~74 m, como las midieron', Math.abs(t.largo - 74.4) < 1.5, t.largo.toFixed(1));
    /* El levantamiento tiene huecos: 103 seguidores sin medir. No se pueden
       perder por el camino — se plantan en la cota de alrededor y se declaran. */
    check('los seguidores sin levantamiento no se pierden',
          t.sin > 0 && t.un === t.filas + t.sin, t.filas + ' + ' + t.sin + ' = ' + t.un);
    /* Está en el hemisferio SUR: con la latitud del deslizador el sol iría al
       revés y los seguidores con él. */
    check('la latitud la manda la planta (San José, hemisferio sur)', t.lat < 0, t.lat);
  }

  /* ---- 18d. azimut de eje y (NCU, GW) ---- */
  await page.evaluate(() => cargaPlanta('bagnarelli'));
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!(PLANTA && PLANTA._un && PLANTA._un.length))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);
  {
    const t = await page.evaluate(() => {
      const u = (PLANTA._filas || []).map(f => f.x), sep = [];
      for (let i = 0; i < u.length - 1; i++) sep.push(+(u[i + 1] - u[i]).toFixed(2));
      return { az: PLANTA.az, lineas: u.length, sep, rot: (PLANTA._un || [])[0].rot };
    });
    /* `rot` del layout viene en GRADOS. Tomarlo como radianes daba 1358°. */
    check('Bagnarelli trae su azimut de eje (23,7°)', Math.abs(t.az - 23.7) < 0.01, t.az);
    check('y llega al render en RADIANES', Math.abs(t.rot - 23.7 * Math.PI / 180) < 1e-9, t.rot);
    /* La implantación real, la que documenta el simulador de backtracking: SEIS
       líneas a pitch 11,0 m. Ni cinco ni siete — agrupar por clave redondeada
       partía una línea en dos (separaciones 11, 11, 0,1, 10,9) y esa línea
       fantasma entraba como una mesa MÁS en la difracción. */
    check('las filas se agrupan en el MARCO DEL EJE: 6 líneas, no una por seguidor',
          t.lineas === 6, t.lineas + ' líneas para 17 seguidores');
    check('y a los 11,0 m de paso que tiene la planta',
          t.sep.length === 5 && t.sep.every(d => Math.abs(d - 11) < 0.15), JSON.stringify(t.sep));
  }
  await page.evaluate(() => cargaPlanta('elburgo'));
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!(PLANTA && PLANTA._un && PLANTA._un.length))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  {
    const t = await page.evaluate(() => Array.prototype.map.call(
      document.querySelectorAll('#lect .l'), e => e.querySelector('.n').textContent));
    /* No todas las TCU hablan con todas las NCU: cada NCU lleva DOS gateways y
       cada TCU cuelga de uno. El Burgo tiene 2 mástiles y CUATRO grupos. */
    const g = t.filter(x => /NCU \d+ · GW \d+/.test(x));
    check('la cobertura se desglosa por (NCU, GW), que es el ámbito real',
          g.length === 4, g.join(' | '));
  }
  {
    /* Y saber CUÁLES son de cada uno: el color por ámbito y el aislar pinchando
       la leyenda. El desglose ya decía cuántas y qué margen; esto dice dónde. */
    const colores = () => page.evaluate(() => {
      const c3 = i => {
        for (const g of PLMESA.list) { const j = g.idx.indexOf(i); if (j < 0) continue;
          const a = g.im.instanceColor.array, k = j * g.per * 3;
          return [a[k], a[k + 1], a[k + 2]].map(v => v.toFixed(3)).join(','); }
        return null; };
      const por = {};
      PLANTA._un.forEach((u, i) => { const k = (u.ncu || 1) + '.' + (u.gw || 1);
        (por[k] = por[k] || {})[c3(i)] = 1; });
      return por;
    });
    await page.click('#segc [data-c="ambito"]', CLIC); await page.waitForTimeout(1500);
    const A = await colores();
    const claves = Object.keys(A).sort();
    const uno = claves.every(k => Object.keys(A[k]).length === 1);
    const distintos = new Set(claves.map(k => Object.keys(A[k])[0]));
    check('coloreando por ámbito, cada (NCU,GW) tiene UN color',
          claves.length === 4 && uno, JSON.stringify(A));
    check('y los cuatro ámbitos salen con colores distintos',
          distintos.size === 4, [...distintos].join(' | '));

    await page.click('#lect .l.amb[data-amb="1.1"]', CLIC); await page.waitForTimeout(1500);
    const B = await colores();
    const APAG = [0x2a, 0x2f, 0x39].map(v => (v / 255).toFixed(3)).join(',');
    check('pinchando NCU 1 · GW 1 en la leyenda, solo quedan encendidos los SUYOS',
          Object.keys(B['1.1'])[0] !== APAG &&
          ['1.2', '2.1', '2.2'].every(k => Object.keys(B[k]).length === 1 && Object.keys(B[k])[0] === APAG),
          JSON.stringify(B));
    await page.click('#lect .l.amb[data-amb="1.1"]', CLIC); await page.waitForTimeout(1200);
    const C = await colores();
    check('y volviendo a pincharlo se sueltan todos',
          Object.keys(C).every(k => Object.keys(C[k])[0] !== APAG), JSON.stringify(C));
    await page.click('#segc [data-c="margen"]', CLIC); await page.waitForTimeout(1200);
  }
  /* ---- 18d-bis. los PILOTES intermedios ---- */
  {
    /* La planta dibujaba cada mesa colgada de un único poste central: un tubo de
       64 m con tres puntos de apoyo. La retícula de apoyos es de la casa y vive
       en `seguidor.js`; aquí se comprueba que la planta la usa, que cada pilote
       cae donde toca y que ninguno flota ni se entierra. */
    const t = await page.evaluate(() => {
      const pil = PLI.filter(L => L.pil);
      const v = new THREE.Vector3(), m = new THREE.Matrix4();
      const extremos = (L, inst) => {                       // fondo y cima del perfil C, en el mundo
        L.im.getMatrixAt(inst, m);
        const bot = v.set(0, -0.5, 0).applyMatrix4(m).clone();
        const top = v.set(0, 0.5, 0).applyMatrix4(m).clone();
        return { bot: bot.y, top: top.y };
      };
      /* NO FLOTAN, medido contra el TERRENO: un rayo hacia abajo desde la cima
         de cada pilote, y su pie tiene que caer donde cae el rayo. Comparar con
         la cota de la fila no vale — con pendiente, el pilote de la punta está
         medio metro por debajo del centro y esa holgura se traga el fallo. */
      const rc = new THREE.Raycaster(); rc.far = 200;
      const abajo = new THREE.Vector3(0, -1, 0);
      const muestras = [];
      pil.forEach(L => { for (let i = 0; i < Math.min(3, L.idx.length); i++)
        for (let l = 0; l < L.locals.length; l++) {
          const inst = i * L.locals.length + l;
          L.im.getMatrixAt(inst, m);
          const bot = v.set(0, -0.5, 0).applyMatrix4(m).clone();
          const top = v.set(0, 0.5, 0).applyMatrix4(m).clone();
          rc.set(top.clone().setY(top.y + 60), abajo);
          const hit = rc.intersectObject(terreno || groundMesh, false)[0];
          muestras.push({ fila: L.idx[i], x: +L.locals[l].elements[12].toFixed(3),
                          bot: bot.y, top: top.y, suelo: hit ? hit.point.y : null });
        } });
      return {
        grupos: pil.length, mods: PLANTA._mods, htube: HTUBE,
        xs: pil.map(L => L.locals.map(mm => +mm.elements[12].toFixed(3))),
        n: pil.reduce((a2, L) => a2 + L.im.count, 0), filas: PLANTA._un.length,
        muestras,
        tris: renderer.info.render.triangles,
      };
    });
    check('la planta pone pilotes intermedios, uno por grupo de módulos',
          t.grupos === t.mods.length && t.grupos > 0, t.grupos + ' de ' + t.mods.length);
    /* La retícula de la casa: ±28 y ±9 m en el completo de 28 módulos por ala, y
       PROPORCIONAL al largo en los acortados — El Burgo tiene medios de 14. */
    const esperado = t.mods.map(k => [-28, -9, 9, 28].map(z => +(z * k / 28).toFixed(3)));
    check('y a la retícula de seguidor.js, proporcional al largo de cada mesa',
          JSON.stringify(t.xs) === JSON.stringify(esperado),
          JSON.stringify(t.xs) + ' esperaba ' + JSON.stringify(esperado));
    check('cuatro por fila, ni uno menos', t.n === 4 * t.filas, t.n + ' de ' + 4 * t.filas);
    /* NO FLOTAN. El perfil C va de la horquilla (0,253 bajo el tubo) al suelo:
       su largo es siempre el mismo y su cima, la misma cota bajo la viga. */
    const largos = t.muestras.map(q => +(q.top - q.bot).toFixed(3));
    check('todos miden lo mismo: de la horquilla al suelo',
          largos.every(L2 => Math.abs(L2 - (HT => HT - 0.253)(t.htube)) < 1e-3),
          [...new Set(largos)].join(',') + ' esperaba ' + (t.htube - 0.253).toFixed(3));
    /* Y su fondo cae en el suelo de SU fila, con la pendiente medida por medio:
       el pilote de la punta de una fila en cuesta no puede quedar en el aire. */
    check('el rayo encuentra terreno bajo todos', t.muestras.every(q => q.suelo !== null),
          t.muestras.filter(q => q.suelo === null).length + ' sin terreno debajo');
    const flotan = t.muestras.filter(q => q.suelo !== null && Math.abs(q.bot - q.suelo) > 0.12);
    check('y su pie CLAVA en el terreno, no en el aire',
          flotan.length === 0, flotan.length + ' de ' + t.muestras.length + ' fuera: ' +
          JSON.stringify(flotan.slice(0, 2).map(q => ({ x: q.x, pie: +q.bot.toFixed(2), suelo: +q.suelo.toFixed(2) }))));
    /* GUARDA DE COSTE. El apoyo entero —tambor, horquilla, virola y casquillo—
       son 5,3 M de triángulos en El Burgo y 62 M en San José: la página se queda
       sin atender ni un clic. En planta va el perfil C y nada más, igual que el
       soporte del slew. */
    check('y sin dispararse: la planta se dibuja con menos de 1,5 M de triángulos',
          t.tris < 1.5e6, (t.tris / 1e6).toFixed(2) + ' M');
  }

  await page.click('[data-p=""]', CLIC); await page.waitForTimeout(2000);

  /* ---- 18d-ter. el corte de estudio: apoyos en la retícula, y el
          amortiguador apoyado en un poste que existe ---- */
  {
    const t = await page.evaluate(() => ({
      mods: MODS, rejilla: Seguidor.pilotesX(MODS), htube: HTUBE,
      postes: rows[0].posts.filter(q => q.poste).map(q => +q.m.position.x.toFixed(3)),
      slew: rows[0].posts.filter(q => !q.poste).length,
      pies: rows[0].damps.map(d => +d.a[0].toFixed(3)),
      fondo: rows[0].posts.filter(q => q.poste)
        .map(q => +(q.m.position.y - (t2 => t2)(HTUBE + q.top) / 2).toFixed(3)),
    }));
    /* El corte ponía DOS apoyos, y en la X que se estima para el amortiguador:
       ni retícula ni pilotes intermedios. Ahora los dos sitios —corte y planta—
       leen la misma retícula de `seguidor.js`. */
    check('el corte de estudio apoya en la retícula de la casa',
          JSON.stringify(t.postes) === JSON.stringify(t.rejilla),
          JSON.stringify(t.postes) + ' esperaba ' + JSON.stringify(t.rejilla));
    check('y el slew sigue en el centro, aparte', t.slew === 1, t.slew);
    /* `buildBeam` se comía `opts.damperX`: la app colocaba sus postes donde toca
       y `parts()` se estimaba la del amortiguador por su cuenta, dejando el pie a
       70 cm del poste más cercano. Va a 30 cm de un poste REAL, hacia el motor. */
    const pegado = t.pies.every(x => t.rejilla.some(q => Math.abs(Math.abs(q) - Math.abs(x)) - 0.30 < 1e-6
                                                      && Math.abs(Math.abs(q) - Math.abs(x)) > 0.29));
    check('y el pie del amortiguador se apoya en un poste que EXISTE',
          pegado, JSON.stringify(t.pies) + ' contra ' + JSON.stringify(t.rejilla));
    check('los apoyos del corte llegan al suelo',
          t.fondo.every(y => Math.abs(y + t.htube) < 1e-3), JSON.stringify(t.fondo) + ' esperaba ' + (-t.htube));
  }

  /* ---- 18e. cada mesa a su tamaño, y los mandos sin llevarse la planta ---- */
  await page.evaluate(() => cargaPlanta('elburgo'));
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!(PLANTA && PLANTA._un && PLANTA._un.length))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  {
    const t = await page.evaluate(() => {
      const L = PLANTA._un.map(u => +(SPANP * u.mr).toFixed(1)), s2 = {};
      L.forEach(v => { s2[v] = (s2[v] || 0) + 1; });
      return { mods: PLANTA._mods, largos: s2, inst: PLI.length };
    });
    /* Antes se montaba UNA mesa canónica y se escalaba: el largo salía bien pero
       los módulos quedaban estirados. Ahora hay un plan de instancias por cuenta
       de módulos — El Burgo tiene medios de 14 y completos de 28. */
    check('cada mesa se monta con SUS módulos, no con una escalada',
          t.mods.length >= 2 && t.mods.indexOf(28) >= 0, JSON.stringify(t.mods));
    check('y los largos que salen son los del layout',
          Object.keys(t.largos).length === t.mods.length, JSON.stringify(t.largos));
  }
  {
    /* Con una planta cargada, la altura de viga llamaba a buildField() —el corte
       de 6 filas— encima de la planta y se llevaba la escena por delante. */
    await set('htube', 1.9); await page.waitForTimeout(2500);
    const t = await page.evaluate(() => ({ planta: !!PLANTA, un: (PLANTA && PLANTA._un || []).length,
                                           inst: PLI.length, err: 0 }));
    check('mover la altura de viga con una planta cargada NO la destruye',
          t.planta && t.un > 200 && t.inst > 0, JSON.stringify(t));
    await set('htube', 1.5); await page.waitForTimeout(2000);
  }
  await page.click('[data-p=""]', CLIC); await page.waitForTimeout(1500);

  /* ---- 18f. la CALIBRACIÓN: qué modelo está hablando ---- */
  {
    /* El simulador enseñaba el modelo desnudo teniendo la calibración de El
       Burgo en el núcleo. Contra lo medido allí, el desnudo sale ~33 dB
       optimista, así que los márgenes con los que se decidía un emplazamiento
       eran los del modelo sin contrastar. */
    const lee = () => page.evaluate(() => {
      const p = params();
      return { cal: CAL, ptx: p.ptxDbm, sigma: p.sigmaDb, bias: p.biasDb || 0,
               nota: document.getElementById('note').textContent,
               m: [...document.querySelectorAll('#lect .m')].map(e => parseFloat(e.textContent)) };
    });
    const c = await lee();
    check('el simulador arranca CALIBRADO, no con el modelo desnudo',
          c.cal === true && c.bias === -33.6, 'cal=' + c.cal + ' sesgo=' + c.bias);
    check('y con la sigma del residuo medido (6,8 dB), no la de fábrica',
          c.sigma === 6.8, c.sigma);
    check('y la página DICE con qué modelo habla',
          /calibrado con El Burgo/i.test(c.nota) && /33,6 dB de sesgo/.test(c.nota),
          c.nota.slice(0, 120));

    await page.click('#segcal [data-k="0"]', CLIC); await page.waitForTimeout(1200);
    const d = await lee();
    check('sin calibrar, el sesgo desaparece de la potencia',
          d.cal === false && d.bias === 0 && Math.abs(d.ptx - c.ptx - 33.6) < 1e-9,
          'ptx ' + c.ptx + ' -> ' + d.ptx);
    /* La calibración es un sesgo GLOBAL: tiene que mover todos los márgenes lo
       mismo, ni un dB más. Si moviera unos más que otros, estaría tocando la
       física en vez de la referencia. */
    const dif = d.m.map((v, i) => +(v - c.m[i]).toFixed(2)).filter(v => !isNaN(v));
    check('y todos los márgenes suben EXACTAMENTE el sesgo, ni un dB más',
          dif.length > 0 && dif.every(v => Math.abs(v - 33.6) < 0.02), JSON.stringify(dif));
    check('y la página avisa de que va sin calibrar',
          /SIN calibrar/i.test(d.nota), d.nota.slice(0, 120));

    /* El sesgo va sobre la potencia QUE DIGA EL MANDO. Aplicado sobre los 19 dBm
       de fábrica, elegir el XBee de +8 se lo comía. */
    await page.click('#segcal [data-k="1"]', CLIC); await page.waitForTimeout(800);
    await page.click('#segr [data-p="8"]', CLIC); await page.waitForTimeout(1200);
    const e8 = await lee();
    check('cambiar de radio no se come la calibración',
          e8.bias === -33.6 && Math.abs(e8.ptx - (8 - 33.6)) < 1e-9, 'ptx ' + e8.ptx);
    await page.click('#segr [data-p="19"]', CLIC); await page.waitForTimeout(1000);
  }

  /* ---- 19. el rizado de dos rayos, dicho y no escondido ---- */
  await page.click('[data-p=""]', CLIC); await page.waitForTimeout(1500);
  {
    /* Es lo que hace que alejar un equipo pueda MEJORAR el margen. Con suelo
       perfecto el rebote es un espejo y el rizado es enorme; con tierra real,
       pequeño. La página tiene que decirlo, no dejar un dB suelto. */
    await set('dhsu', 50); await page.waitForTimeout(250);
    const pec = await page.evaluate(() => { const l = [...document.querySelectorAll('#lect .l')].pop();
      return { m: parseFloat(l.querySelector('.m').textContent), x: l.querySelector('.x').textContent }; });
    await page.click('[data-g="real"]', CLIC); await page.waitForTimeout(300);
    const real = await page.evaluate(() => { const l = [...document.querySelectorAll('#lect .l')].pop();
      return { m: parseFloat(l.querySelector('.m').textContent), x: l.querySelector('.x').textContent }; });
    check('con suelo perfecto el rizado se avisa', /± *\d+ dB en 3 m/.test(pec.x), pec.x);
    check('con tierra real el rizado casi desaparece y no se avisa', !/± *\d+ dB en 3 m/.test(real.x), real.x);
    check('la lectura da la probabilidad de enlace, no solo el dB', /p=\d+ %/.test(real.x), real.x);
    await page.click('[data-g="pec"]', CLIC); await page.waitForTimeout(250);
  }

  check('sin errores de consola al final', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + ok + ' OK, ' + ko + ' FAIL');
  process.exit(ko ? 1 : 0);
})();
