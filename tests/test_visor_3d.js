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
  const conTcu = rows.filter(r => { let f = false; r.spin.traverse(n => {
    const p = n.geometry && n.geometry.parameters;
    if (p && eq(p.width,0.50) && eq(p.height,0.26) && eq(p.depth,0.36)) f = true; }); return f; }).length;
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
  await page.waitForTimeout(1800);

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
  check('la antena de la HSU, a la cota de su plano', near(s.hsuPos[1], s.hsuCat, 1e-9), s.hsuPos[1] + ' vs ' + s.hsuCat);
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
  await page.click('[data-d="man"]'); await page.waitForTimeout(150);
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
  await page.click('[data-d="sol"]'); await page.waitForTimeout(150);

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
    await page.click('[data-d="man"]'); await set('tilt', 30); await page.waitForTimeout(150);
    const alto = await page.evaluate(SONDA);           // 3,15 m: por encima de la cresta
    await set('hncu', 1.0); await page.waitForTimeout(200);
    const bajo = await page.evaluate(SONDA);           // 1,00 m: por debajo del canto bajo
    const dA = alto.rec.find(r => r.n === 'ncu0').dif, dB = bajo.rec.find(r => r.n === 'ncu0').dif;
    check('la NCU por encima de la cresta CRUZA las mesas: más difracción', dA > dB + 10,
          'difr. ' + dA.toFixed(1) + ' dB a ' + alto.hncu + ' m vs ' + dB.toFixed(1) + ' dB a ' + bajo.hncu + ' m');
    check('el salto más corto a la NCU no cruza ninguna mesa: difracción 0',
          near(alto.rec.find(r => r.n === 'ncu2').dif, 0, 1e-9), alto.rec.find(r => r.n === 'ncu2').dif);
  }
  await set('hncu', 3.15); await page.click('[data-d="sol"]'); await page.waitForTimeout(200);

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
  await page.click('[data-m="7"]'); await page.waitForTimeout(1200);
  s = await page.evaluate(SONDA);
  check('el enlace de la HSU arranca EN el látigo', s.anclaje.hsuLatigo < 0.06, s.anclaje.hsuLatigo);
  check('y no en el anemómetro ultrasónico, que está a la misma altura',
        s.anclaje.hsuAnemo > 0.15, s.anclaje.hsuAnemo);
  check('el enlace de la NCU arranca EN su látigo', s.anclaje.ncuLatigo < 0.06, s.anclaje.ncuLatigo);

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
    const mAlba = alba.lect[2].m, mMedio = medio.lect[2].m;
    check('con las palas de canto el salto a la NCU se cae', mAlba < 15, mAlba + ' dB');
    check('con las palas planas el mismo salto va holgado', mMedio > 40, mMedio + ' dB');
    /* El salto entre vecinos aguanta el día entero. Ojo: NO siempre "pasa por
       debajo" — con las palas muy de canto el borde bajo cae por debajo de la
       antena y hasta ese salto empieza a cruzar mesa. Lo que se sostiene es que
       aguanta, porque roza el borde en vez de atravesar la banda entera. */
    check('el salto entre vecinos aguanta a las dos horas',
          alba.lect[0].m > 40 && medio.lect[0].m > 40, alba.lect[0].m + ' / ' + medio.lect[0].m);
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
  await page.click('[data-d="man"]'); await page.waitForTimeout(150);
  await set('tilt', -33); await page.waitForTimeout(150);
  s = await page.evaluate(SONDA);
  check('en manual el ángulo es el del deslizador', near(s.beta, -33, 1e-9), s.beta);
  check('en manual el deslizador NO está bloqueado',
        await page.evaluate(() => !document.getElementById('tilt').disabled));
  await page.click('[data-d="sol"]'); await page.waitForTimeout(150);
  check('con el sol, el deslizador se bloquea (lo manda la hora)',
        await page.evaluate(() => document.getElementById('tilt').disabled));

  check('sin errores de consola al final', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + ok + ' OK, ' + ko + ' FAIL');
  process.exit(ko ? 1 : 0);
})();
