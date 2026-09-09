// El seguidor de la casa es BÍFILO, y el simulador lo dibujaba a medias.
//
// POR QUÉ EXISTE. Un seguidor son DOS filas de módulos movidas por el mismo
// motor, con UNA sola TCU. `unidades()` devolvía UNA fila por unidad del layout
// cuando la planta no tiene levantamiento, así que Fayón salía con 24 filas
// donde hay 48. Y eso no es un fallo de dibujo: `unidades()` alimenta
// `filasPlanta()` → `mesasEnPlanta()`, que es QUIEN CUENTA LAS MESAS QUE CRUZA
// CADA RAYO. Con la mitad de filas se cuenta la mitad de la obstrucción y todos
// los márgenes de esa planta salen optimistas.
//
// Que Fayón es bífila lo dicen cuatro cosas independientes: sus bloques del DWG
// se llaman «PFV-Seguidor 2x1V48», sus 2.112 módulos solo salen con dos filas,
// sus unidades van a 12 m con paso de fila 6, y los dos levantamientos que hay
// (Ayora, San José) miden exactamente 2 filas por seguidor — 1.508/754.
//
// Y LA OTRA MITAD DEL ARREGLO: el margen se calculaba POR FILA, así que Ayora
// contaba 1.508 TCU donde hay 754 y cada NCU salía con el doble de equipos. Una
// TCU por seguidor, en la viga del motor.
//
//   node tests/test_bifila_plantas.js
const { chromium } = require('playwright');
const BASE = process.env.URL || 'http://127.0.0.1:8099/index.html';
/* DÓNDE ESTÁ CHROMIUM. `PW_CHROMIUM` si se dice; si no, el del contenedor de
   desarrollo cuando existe; y si tampoco, NADA — que es lo que hace que
   Playwright use el navegador que él mismo gestiona. Estaba clavada la ruta
   del contenedor como valor POR DEFECTO, y en un runner de GitHub eso es
   «executable doesn't exist»: los tres bancos de navegador morían en un
   segundo, antes de comprobar nada. */
const PW_DEV = '/opt/pw-browsers/chromium';
const EXEC = process.env.PW_CHROMIUM || (require('fs').existsSync(PW_DEV) ? PW_DEV : undefined);
let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } };

// lo que se pregunta a la página una vez cargada la planta
const SONDA = `(() => {
  const UN = PLANTA._un || unidades();
  const T  = PLANTA._tcus || tcusDe(UN);
  const u  = f => f.x*Math.cos(f.rot||0) + f.n*Math.sin(f.rot||0);
  const us = [...new Set(UN.map(f => Math.round(u(f)*100)/100))].sort((a,b)=>a-b);
  const hue = []; for (let i=1;i<us.length;i++) { const d=us[i]-us[i-1]; if (d>0.4) hue.push(d); }
  hue.sort((a,b)=>a-b);
  /* Lo que el RENDER conto de verdad, no lo que devuelvan las funciones si se
     las llama aparte: _res.n es el numero que la pagina ensena (de N
     seguidores), y _mgFila el margen con el que pinto cada fila. */
  const res = PLANTA._res || {}, mgf = PLANTA._mgFila || [];
  const porTrk = {};
  UN.forEach((f,i) => { const k = f.trk!=null?f.trk:i; (porTrk[k]=porTrk[k]||[]).push(mgf[i]); });
  const mismo = Object.values(porTrk).every(v => v.every(x => Math.abs(x - v[0]) < 1e-6));
  return { trk: PLANTA.trk.length, filas: UN.length, tcus: T.length,
           nRender: res.n, mismoMargen: mismo, texto: (document.getElementById("lect")||{}).textContent||"",
           bif: PLANTA.bif, paso: hue.length ? hue[hue.length>>1] : null,
           // con levantamiento las filas traen cota y pendiente; sin él, todo a 0
           conCota: UN.some(f => f.y !== 0) && UN.some(f => f.tilt !== 0),
           empar: PLANTA.empar || null,
           conTrk: UN.every(f => f.trk != null),
           /* SEPARACIÓN REAL entre las dos vigas de un mismo seguidor. Contar
              filas no basta: con un filaZ inventado salen las mismas 34 y en el
              sitio equivocado, que es lo que apantalla rayos que no toca. */
           sep: (() => { const d = [];
             const por = {};
             UN.forEach((f, i) => { const k = f.trk != null ? f.trk : i; (por[k] = por[k] || []).push(f); });
             Object.values(por).forEach(v => { if (v.length === 2) d.push(Math.hypot(v[1].x - v[0].x, v[1].n - v[0].n)); });
             d.sort((a, b) => a - b);
             return d.length ? +d[d.length >> 1].toFixed(3) : null; })(),
           /* Y QUE EL DESPLAZAMIENTO SEA PERPENDICULAR AL TUBO. La distancia
              entre las dos vigas es 2·filaZ APUNTE DONDE APUNTE, así que medirla
              no dice si van bien puestas: hay que mirar la componente A LO LARGO
              del tubo, que tiene que ser CERO. Con el signo cambiado salía
              fz·sen(2a) y las filas quedaban torcidas — solo se ve en plantas
              con el eje girado, y de las siete solo Bagnarelli lo tiene. */
           desvio: (() => { const por = {}, d = [];
             UN.forEach((f, i) => { const k = f.trk != null ? f.trk : i; (por[k] = por[k] || []).push(f); });
             Object.values(por).forEach(v => { if (v.length !== 2) return;
               const a2 = v[0].rot || 0;
               const v0 = v[0].x * Math.sin(a2) + v[0].n * Math.cos(a2);
               const v1 = v[1].x * Math.sin(a2) + v[1].n * Math.cos(a2);
               d.push(Math.abs(v1 - v0)); });
             return d.length ? +Math.max(...d).toFixed(3) : null; })(),
           /* LO QUE SE DIBUJA, PIEZA A PIEZA. Este banco preguntaba a las
              funciones (tcusDe) y al resultado (_res.n), y las dos daban el
              número bueno mientras el RENDER pintaba una TCU, un motor y un
              seccionador POR FILA: El Burgo salía con 430 TCU donde hay 215 y
              una planta bífila se veía exactamente igual que una monofila. El
              plan de instancias describe UNA viga; instanciarlo por fila
              duplica lo que solo va en la del motor. */
           inst: (() => { const c = {}, l = {};
             PLI.forEach(q => { c[q.key] = (c[q.key]||0) + q.im.count; l[q.key] = q.locals.length; });
             const por = {}; Object.keys(c).forEach(k => por[k] = c[k] / l[k]);
             por.tcuDib = por.tcu || 0;
             return por; })(),
           /* EL CAD COMO NIVEL DE DETALLE. El glb son 170 k triangulos y el STEP 20 k:
              instanciados en cada seguidor eran 140 M en Ayora y la pagina dejo de
              atender un clic (el banco del visor murio por tiempo). Asi que van
              TRES copias en las TCU mas cercanas a donde mira la camara, tapando
              su caja; se comprueba que estan, que la mas cercana al encuadre lleva
              el CAD encima de SU viga, y que su caja se ha escondido. */
           cad: (() => { if (!PLCAD) return null;
             frame('antena');
             cadCerca(true);
             const tgt = controls.target, UN = PLANTA._un;
             let f = -1, bd = 1e18;
             PLANTA._tcus.forEach(T => { const t = UN[T.fila]; const d = Math.hypot(t.x - tgt.x, -t.n - tgt.z); if (d < bd) { bd = d; f = T.fila; } });
             const k = PLCAD.filas.indexOf(f);
             const g = k >= 0 ? PLCAD.tcu[k] : null;
             const v = new THREE.Vector3(); if (g) v.setFromMatrixPosition(g.matrix);
             const t = UN[f];
             // la caja de ESA fila: hay una entrada 'tcu' por grupo de modulos
             const caja = PLI.find(L => L.key === 'tcu' && L.idx.indexOf(f) >= 0), j = caja ? caja.idx.indexOf(f) : -1;
             const m = new THREE.Matrix4(); if (j >= 0) caja.im.getMatrixAt(j, m);
             let tri = 0; PLCAD.tcu.forEach(gg => gg.traverse(o => { if (o.isMesh && o.geometry.index) tri += o.geometry.index.count / 3; }));
             return { copias: PLCAD.tcu.length, secc: PLCAD.secc.length, visibles: PLCAD.tcu.filter(gg => gg.visible).length,
                      enLaMasCercana: k >= 0 && !!g && g.visible,
                      dViga: g ? +Math.hypot(v.x - t.x, v.z + t.n, v.y - (t.y + HTUBE)).toFixed(3) : null,
                      cajaOculta: j >= 0 && m.elements[0] === 0 && m.elements[5] === 0,
                      triCAD: tri, cadListo: !!CAD.tcu && !!CAD.secc }; })(),
           ant: PLANT_ANT ? PLANT_ANT.dot.count : null,
           /* La antena a la cota del CALCULO: hA sobre el suelo de su fila. */
           antY: (() => { if (!PLANT_ANT) return null;
             const m = new THREE.Matrix4(), v = new THREE.Vector3(), d = [];
             PLANT_ANT.i.forEach((iu, j) => { PLANT_ANT.dot.getMatrixAt(j, m);
               v.setFromMatrixPosition(m); d.push(+(v.y - UN[iu].y).toFixed(4)); });
             return d.length ? [Math.min(...d), Math.max(...d)] : null; })(),
           hA: Math.max(0.15, HTUBE - (+document.getElementById("drop").value)),
           /* LAS BIELAS: el eje de transmision que cruza de una viga a la otra.
              Sin el, dos filas a 6 m con una TCU se leen como dos seguidores. Se
              comprueba que hay uno por bifilo y que sus EXTREMOS caen en las dos
              filas del par: un eje en el sitio equivocado o girado a lo largo
              del tubo daria el mismo recuento. */
           eje: (() => { if (!PLANT_EJE) return { n: 0 };
             const por = {};
             UN.forEach((f, i) => { const k = f.trk != null ? f.trk : i; (por[k] = por[k] || []).push(f); });
             const bif = Object.values(por).filter(v => v.length === 2);
             const m = new THREE.Matrix4(), v3 = new THREE.Vector3();
             let peor = 0;
             bif.forEach((v, j) => { PLANT_EJE.eje.getMatrixAt(j, m);
               const sep = Math.hypot(v[1].x - v[0].x, v[1].n - v[0].n);
               [+1, -1].forEach(sg => {
                 v3.set(0, 0, sg * PLANT_EJE.sep / 2).applyMatrix4(m);       // extremo del eje (escalado a sep)
                 const d = Math.min(...v.map(f => Math.hypot(v3.x - f.x, -v3.z - f.n)));
                 peor = Math.max(peor, d); });
               // y a la altura de la viga (la geometria ya lleva su -0,22 bajo el tubo)
               v3.set(0, 0, 0).applyMatrix4(m);
               peor = Math.max(peor, Math.abs(v3.y - ((v[0].y + v[1].y) / 2 + HTUBE)));
             });
             return { n: PLANT_EJE.n, cardanes: PLANT_EJE.car.count, sep: PLANT_EJE.sep, peor: +peor.toFixed(3) }; })(),
           // la TCU de cada seguidor tiene que ser la fila OESTE (menor u)
           oeste: T.every(t => { const mias = UN.map((f,i)=>[f,i]).filter(([f])=>f.trk===t.trk);
                                 return mias.every(([f]) => u(f) >= u(UN[t.fila]) - 1e-6); }) };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|WebGL|GPU/.test(m.text())) errs.push(m.text()); });

  // la planta se elige con el selector de la página, como haría cualquiera
  let cargada = false;
  const carga = async (planta) => {
    if (!cargada) { await page.goto(BASE, { waitUntil: 'networkidle' }); cargada = true;
                    await page.waitForTimeout(800);
                    // el glb y el STEP llegan por red: sin esperarlos se comprobaria la caja
                    for (let i = 0; i < 40 && !(await page.evaluate(() => CAD.listo)); i++) await page.waitForTimeout(250); }
    await page.evaluate(p => cargaPlanta(p), planta);
    for (let i = 0; i < 60; i++) {
      const listo = await page.evaluate(() =>
        typeof PLANTA !== 'undefined' && PLANTA && PLANTA.trk && PLANTA.trk.length > 0);
      if (listo) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(500);
    return page.evaluate(SONDA);
  };

  // ── FAYÓN: el caso que se veía a ojo ──────────────────────────────────────
  console.log('\n· Fayón: 24 seguidores, 48 filas, 24 TCU');
  const f = await carga('fayon');
  check('el layout trae 24 seguidores', f.trk === 24, f.trk);
  check('y se dibujan 48 filas: cada seguidor son DOS', f.filas === 48, f);
  check('pero las TCU siguen siendo 24, una por seguidor', f.tcus === 24, f.tcus);
  check('y son 24 las que el render CUENTA, no 48', f.nRender === 24, f.nRender);
  check('la página lo dice así: «de 24 seguidores»', /de 24 seguidores/.test(f.texto),
        (f.texto||'').slice(0, 120));
  check('las dos filas de un seguidor se pintan con el MISMO margen',
        f.mismoMargen === true);
  check('y el RENDER dibuja 24 TCU, no una por fila', f.inst.tcuDib === 24, f.inst);
  check('el CAD de la TCU y del seccionador está, como nivel de detalle: 3 copias, no 24',
        f.cad && f.cad.cadListo && f.cad.copias === 3 && f.cad.secc === 3 && f.cad.visibles === 3, f.cad);
  check('y la TCU que encuadra la cámara lleva el CAD ENCIMA DE SU VIGA, con su caja escondida',
        f.cad && f.cad.enLaMasCercana && f.cad.dViga < 0.01 && f.cad.cajaOculta, f.cad);
  check('con lo que cuesta el corte de estudio, no la planta entera (< 600 k triángulos)',
        f.cad && f.cad.triCAD > 100000 && f.cad.triCAD < 600000, f.cad && f.cad.triCAD);
  check('un motor y un seccionador por seguidor, no por viga',
        f.inst.motor === 24 && f.inst.secc === 24, f.inst);
  check('pero las mesas y los tubos sí van en las dos vigas: 48',
        f.inst.mesa === 48 && f.inst.tube === 48, f.inst);
  check('y la corona y su poste también, que la gemela gira igual',
        f.inst.corona === 48 && f.inst.soporte === 48, f.inst);
  check('y sus 24 bielas: un eje de transmisión por seguidor, con dos cardanes',
        f.eje.n === 24 && f.eje.cardanes === 48, f.eje);
  check('cuyos extremos caen en las dos filas del par, a la altura de la viga',
        f.eje.peor < 0.05, f.eje);
  check('cada TCU dibuja su antena, y cuelga a la cota que usa el cálculo',
        f.ant === 24 && f.antY && Math.abs(f.antY[0] - f.hA) < 1e-3 &&
        Math.abs(f.antY[1] - f.hA) < 1e-3, [f.ant, f.antY, f.hA]);
  /* EL SECCIONADOR, BIEN ORIENTADO. La malla del STEP se cargaba con un giro de
     90 grados que la dejaba CRUZADA al tubo y con la rueda mirando de lado. Se
     mide la propia geometria: el largo (0,27) tiene que ir en X (el tubo) y el
     mando -que sobresale del cuerpo- hacia -Y, el suelo. */
  const sec = await page.evaluate(() => {
    if (!CAD.secc) return null;
    const g = CAD.secc; g.computeBoundingBox(); const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3());
    // el cuerpo ocupa la parte alta; lo que asoma por debajo del cuerpo es el mando
    const pos = g.attributes.position; let bajo = 0, alto = 0;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < bb.min.y + 0.02) bajo++; if (y > bb.max.y - 0.02) alto++; }
    return { sx: +sz.x.toFixed(3), sy: +sz.y.toFixed(3), sz: +sz.z.toFixed(3), bajo, alto };
  });
  check('el seccionador va con el largo A LO LARGO del tubo (0,27 m en X)', sec && sec.sx > 0.25 && sec.sz < 0.15, sec);
  check('y con la rueda hacia el SUELO: lo que asoma por abajo es el mando, no una cara entera',
        sec && sec.bajo > 500 && sec.bajo < sec.alto, sec);
  check('las filas quedan al paso de la planta (6 m), no a 12',
        Math.abs(f.paso - 6) < 0.2, f.paso);
  /* La decisión sale del LAYOUT —de su `filaZ` y de `mesa.tipos`—, no de una
     lista de plantas escrita a mano ni de medir la retícula. */
  check('la decisión sale del layout, con su filaZ',
        f.bif && f.bif.si === true && f.bif.fz === 3 &&
        /dos filas a ±3 m/.test(f.bif.porque || ''), f.bif);
  check('cada fila sabe de qué seguidor es', f.conTrk === true);
  check('y la TCU va en la viga del motor: la fila oeste', f.oeste === true);

  // ── AYORA: con levantamiento. Las filas ya estaban bien; las TCU no ───────
  /* Ayora perdió sus tres TCU de la NCU7, así que el layout tiene 751 y el
     fichero de cotas 754. El emparejamiento va por SITIO: si fuera por índice,
     como antes, el guard de "mismo número" fallaría y Ayora se quedaría sin
     levantamiento —terreno plano— sin decir nada. */
  console.log('\n· Ayora: levantamiento emparejado por sitio, y una TCU por seguidor');
  const a = await carga('ayora');
  check('751 seguidores (tres TCU retiradas, as-built)', a.trk === 751, a.trk);
  check('1.502 filas medidas, el doble exacto', a.filas === 1502, a.filas);
  check('y 751 TCU, no 1.502', a.tcus === 751, a.tcus);
  check('y el render cuenta 751, que es lo que enseña', a.nRender === 751, a.nRender);
  check('las dos filas medidas de un seguidor comparten margen', a.mismoMargen === true);
  /* Y el veredicto del layout CUADRA con lo que midió el levantamiento: dice
     bífila, y el levantamiento trae exactamente 2 filas por seguidor. Dos
     fuentes independientes diciendo lo mismo. */
  check('el layout dice bífila y el levantamiento lo confirma: 2 filas por seguidor',
        a.bif && a.bif.si === true && a.filas === 2 * a.trk, [a.bif, a.filas, a.trk]);
  /* Y no se confunden las dos cosas: con levantamiento las filas están MEDIDAS,
     así que la guarda de solapes —que es sobre el recurso de partir— no aplica. */
  check('y lo dice bien: las filas vienen medidas, no deducidas',
        /MEDIDAS del levantamiento/.test(a.bif.porque || ''), a.bif.porque);
  check('cada fila medida sabe de qué seguidor es', a.conTrk === true);
  check('y la TCU es la fila oeste del par', a.oeste === true);
  check('sigue teniendo el levantamiento: las filas van a su cota, no a 0',
        a.conCota === true);
  /* EL TERRENO NO SE COME LAS MESAS. La rejilla del suelo iba a 140x140 fijo:
     en Ayora, celdas de 18x21 m sobre decenas de metros de desnivel, y el suelo
     interpolado pasaba hasta 10 m por ENCIMA de la fila. Se muestrea el terreno
     (bilineal, como lo dibuja la GPU) en el centro de CADA fila medida y se
     compara con la cota de la fila. */
  const ter = await page.evaluate(() => {
    const u = terreno.userData, pos = terreno.geometry.attributes.position;
    const alt = (X, Zc) => {
      // columnas NO uniformes en X (una en cada linea de fila): se busca la celda
      let ix = 0; while (ix < u.Mx - 1 && u.cols[ix + 1] <= X) ix++;
      const fz = (Zc - u.cz + u.h / 2) / u.h * u.Mz;
      const iz = Math.min(Math.max(Math.floor(fz), 0), u.Mz - 1);
      const tx = Math.min(1, Math.max(0, (X - u.cols[ix]) / (u.cols[ix + 1] - u.cols[ix]))), tz = fz - iz;
      const at = (i, k) => pos.getY(k * (u.Mx + 1) + i);
      return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz; };
    const d = PLANTA.cot.filas.map(f => alt(f.x, -f.nm) - f.ym).sort((a, b) => a - b);
    return { n: d.length, min: +d[0].toFixed(2), p05: +d[d.length * 0.05 | 0].toFixed(2), p95: +d[d.length * 0.95 | 0].toFixed(2), max: +d[d.length - 1].toFixed(2),
             celda: [+Math.max(...u.cols.slice(1).map((c, i) => c - u.cols[i])).toFixed(1), +(u.h / u.Mz).toFixed(1)], vertices: pos.count,
             // cuantas lineas de fila tienen SU columna en la rejilla
             enLinea: PLANTA.cot.xs.filter(k => u.cols.some(c => Math.abs(c - k) < 1e-6)).length, lineas: PLANTA.cot.xs.length };
  });
  // a lo largo de la fila, 6 m; a traves, una columna por linea y relleno cada
  // 6 m donde no las hay (en un pasillo sin filas puede llegar a dos celdas)
  check('la rejilla del terreno va al paso de las filas (6 m a lo largo, <= 12 m de relleno a través)',
        ter.celda[0] <= 12.5 && ter.celda[1] <= 6.05, ter);
  check('y cada línea de fila tiene su columna: la fila queda sobre un vértice con su cota exacta',
        ter.enLinea === ter.lineas && ter.lineas > 100, ter);
  check('y en el centro de las 1.502 filas el suelo dibujado queda a menos de 0,5 m de su cota (p05..p95)',
        ter.n === 1502 && ter.p05 > -0.5 && ter.p95 < 0.5, ter);
  check('y NUNCA por encima del tubo: ninguna mesa comida por el terreno (max < 1 m)', ter.max < 1.0 && ter.min > -3, ter);
  /* Y SIN CORNISAS. Fuera de las filas el suelo se rellenaba prolongando la
     fila mas cercana -plana-, y cada zona quedaba a la cota de "su" fila con
     acantilados entre zonas: saltos de hasta 57 m entre columnas vecinas (por
     6 m). Se miden los saltos entre vertices vecinos en toda la rejilla; los
     bancales reales de Ayora son de unos 5 m, y eso es el techo. */
  const sal = await page.evaluate(() => {
    const u = terreno.userData, pos = terreno.geometry.attributes.position, dz = [], dx = [];
    for (let k = 0; k < u.Mz; k++) for (let i = 0; i <= u.Mx; i++) {
      dz.push(Math.abs(pos.getY((k + 1) * (u.Mx + 1) + i) - pos.getY(k * (u.Mx + 1) + i)));
      if (i < u.Mx) dx.push(Math.abs(pos.getY(k * (u.Mx + 1) + i + 1) - pos.getY(k * (u.Mx + 1) + i)) / Math.max(1, u.cols[i + 1] - u.cols[i]) * 6);
    }
    const st = v => { v.sort((a, b) => a - b); return { p99: +v[v.length * 0.99 | 0].toFixed(2), max: +v[v.length - 1].toFixed(2) }; };
    return { z: st(dz), x: st(dx) };
  });
  check('el suelo es continuo: entre vértices vecinos (por 6 m) el p99 del salto baja de 2 m', sal.z.p99 < 2 && sal.x.p99 < 2, sal);
  check('y el salto máximo no pasa de un bancal (8 m), no de una cornisa de 57', sal.z.max < 8 && sal.x.max < 8, sal);
  /* LA PENDIENTE DE CADA FILA, CON SU SIGNO. El tubo iba girado al reves: en
     la fila de mas desnivel (5,5 m entre extremos) quedaba 7 m al aire en un
     extremo y 4 m bajo tierra en el otro, con los postes colgando. Se
     reconstruye la matriz de la viga como la escribe pintaPlanta y se mira
     donde caen sus DOS extremos respecto al suelo. Y los pies de los postes. */
  const inc = await page.evaluate(() => {
    const u = terreno.userData, pos = terreno.geometry.attributes.position;
    const alt = (X, Zc) => { let ix = 0; while (ix < u.Mx - 1 && u.cols[ix + 1] <= X) ix++;
      const fz = (Zc - u.cz + u.h / 2) / u.h * u.Mz, iz = Math.min(Math.max(Math.floor(fz), 0), u.Mz - 1);
      const tx = Math.min(1, Math.max(0, (X - u.cols[ix]) / (u.cols[ix + 1] - u.cols[ix]))), tz = fz - iz;
      const at = (i, k) => pos.getY(k * (u.Mx + 1) + i);
      return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz; };
    const UN = PLANTA._un, d = [];
    UN.forEach(t => { if (!t.med) return;
      const L = PLI.find(q => q.key === 'tube' && q.idx.indexOf(UN.indexOf(t)) >= 0); if (!L) return;
      const j = L.idx.indexOf(UN.indexOf(t)), m = new THREE.Matrix4(); L.im.getMatrixAt(j * L.locals.length, m);
      // el primer tubo es media viga en +X: su centro esta a +len/4; de ahi a los extremos
      const half = (t.mr * SPANP) / 2, c = new THREE.Vector3().setFromMatrixPosition(m);
      const dir = new THREE.Vector3(1, 0, 0).transformDirection(m);
      [+1, -1].forEach(sg => { const e = c.clone().addScaledVector(dir, sg * half - half / 2); d.push(e.y - HTUBE - alt(e.x, e.z)); });
    });
    d.sort((a, b) => a - b);
    const P = PLI.find(q => q.key === 'pilote'), m = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), dp = [];
    for (let j = 0; j < P.im.count; j++) { P.im.getMatrixAt(j, m); m.decompose(v, q, s); dp.push(v.y - s.y / 2 - alt(v.x, v.z)); }
    dp.sort((a, b) => a - b);
    return { extremos: { n: d.length, p01: +d[d.length * 0.01 | 0].toFixed(2), p99: +d[d.length * 0.99 | 0].toFixed(2), max: +Math.max(-d[0], d[d.length - 1]).toFixed(2) },
             pies: { n: dp.length, p01: +dp[dp.length * 0.01 | 0].toFixed(2), p99: +dp[dp.length * 0.99 | 0].toFixed(2), max: +Math.max(-dp[0], dp[dp.length - 1]).toFixed(2) } };
  });
  check('los DOS extremos de cada tubo van a 1,5 m de SU suelo: la pendiente con el signo bueno (p01..p99 en ±0,3 m)',
        inc.extremos.n > 2000 && inc.extremos.p01 > -0.3 && inc.extremos.p99 < 0.3, inc.extremos);
  check('y ningún extremo se va más de 1 m (antes: 7 m al aire y 4 bajo tierra)', inc.extremos.max < 1.0, inc.extremos);
  check('los pies de los postes tocan el suelo (p01..p99 en ±0,3 m), no cuelgan', inc.pies.p01 > -0.3 && inc.pies.p99 < 0.3, inc.pies);
  check('los 751 encuentran su entrada en el levantamiento',
        a.empar && a.empar.lejos === 0 && a.empar.n === 751, a.empar);
  check('ninguna entrada se reparte entre dos seguidores',
        a.empar && a.empar.repetidas === 0, a.empar);
  /* «El más cercano» sin tope pega cualquier cosa: el emparejamiento tiene que
     ser fino, no solo existir. El listón es medio paso de fila (6/2 = 3 m, y
     medido sale 3,12): el punto del layout unas veces cae en el centro del par
     y otras en una de las filas. Más allá de eso ya estarías robándole la fila
     al vecino, que está a 6. */
  check('y cada uno casa con la SUYA: a menos de medio paso de fila',
        a.empar && a.empar.dmax < 4, a.empar && a.empar.dmax);

  // ── PÁRAMO: monofila de verdad. No se parte ───────────────────────────────
  console.log('\n· Páramo: filaZ 0. Ni se parte ni se inventa nada');
  const p = await carga('paramo');
  check('396 seguidores y 396 filas', p.trk === 396 && p.filas === 396, p);
  check('396 TCU', p.tcus === 396, p.tcus);
  check('y en una monofila no hay biela que dibujar', p.eje.n === 0, p.eje);
  check('y en una monofila el render dibuja una TCU por fila, que es lo mismo',
        p.inst.tcuDib === 396 && p.inst.mesa === 396, p.inst);
  /* Y el motivo tiene que ser el SUYO: «declara filaZ 0», que es la planta
     diciendo que su seguidor es de una fila. No vale el mensaje de «no lo
     declara»: son dos cosas distintas y una de ellas es un dato. */
  check('y el motivo es que DECLARA filaZ 0, no que falte el dato',
        p.bif && p.bif.si === false && /declara filaZ 0/.test(p.bif.porque || ''), p.bif);

  // ── EL BURGO: el seguidor canónico. No declara filaZ porque ES el de la casa
  console.log('\n· El Burgo: bífila por las cotas canónicas de seguidor.js');
  const e = await carga('elburgo');
  check('215 seguidores y 430 filas', e.trk === 215 && e.filas === 430, e);
  check('con 215 TCU', e.tcus === 215, e.tcus);
  check('y el render dibuja 215 TCU: El Burgo se veía monofila con 430',
        e.inst.tcuDib === 215 && e.inst.motor === 215, e.inst);
  check('con sus 430 mesas y 430 tubos, que las dos vigas llevan módulos',
        e.inst.mesa === 430 && e.inst.tube === 430, e.inst);
  check('y 215 antenas colgando, una por seguidor', e.ant === 215, e.ant);
  check('y 215 bielas cruzando de una viga a la otra: se veía sin ellas',
        e.eje.n === 215 && e.eje.peor < 0.05, e.eje);
  check('las filas quedan a 6 m', Math.abs(e.paso - 6) < 0.2, e.paso);
  check('y las dos vigas de un seguidor, a 6,00 m', Math.abs(e.sep - 6) < 0.01, e.sep);

  /* TODAS SON BÍFILAS SALVO DONDE EL LAYOUT DIGA OTRA COSA. Eso NO se deduce de
     la retícula: lo declara el layout, y es lo que hace `terreno.html`, que
     lleva dibujando estas plantas bien desde el principio. Inferirlo —midiendo
     si al partir el paso se quedaba en la mitad— acertaba en unas y fallaba en
     otras: dejaba Túnez y Polvorín de una fila cuando son bífilos. */
  console.log('\n· Túnez: 19 seguidores -> 38 filas');
  const tz = await carga('tunez');
  check('19 seguidores -> 38 filas', tz.trk === 19 && tz.filas === 38, [tz.trk, tz.filas]);
  check('y 19 TCU', tz.tcus === 19, tz.tcus);
  check('con sus vigas a 6,25 m: 2 x 3,125', Math.abs(tz.sep - 6.25) < 0.01, tz.sep);

  /* BAGNARELLI Y POLVORÍN: también bífilas, y con el mismo criterio que la
     tarjeta de planta. `terreno.html` pone las dos vigas a ±filaZ SIEMPRE, sin
     guarda ninguna, y es la que lleva dibujando estas plantas bien desde el
     principio. Yo llegué a bloquearlas por unos solapes de 8 cm: era mi
     invento, y dejaba media planta sin dibujar. Los solapes se MIDEN y se
     enseñan —el layout de Bagnarelli dice que 5 seguidores van extrapolados—
     pero no deciden. Que Bagnarelli es bífila lo prueba su cartera: 14
     completos x 2 alas x 21 + 3 medios x 2 x 10 = 648 por fila, y x2 = 1.296,
     que son EXACTAMENTE los módulos declarados. */
  console.log('\n· Bagnarelli y Polvorín: dos vigas a ±filaZ, como en la tarjeta de planta');
  const bg = await carga('bagnarelli');
  check('Bagnarelli: 17 seguidores -> 34 filas', bg.trk === 17 && bg.filas === 34, [bg.trk, bg.filas]);
  check('y 17 TCU', bg.tcus === 17, bg.tcus);
  check('con el filaZ de su layout (2,75), no uno deducido', bg.bif.fz === 2.75, bg.bif);
  check('y las dos vigas quedan a 5,50 m: 2 x 2,75, el de SU layout',
        Math.abs(bg.sep - 5.5) < 0.01, bg.sep);
  /* Bagnarelli es la ÚNICA de las siete con el eje girado (23,7°), así que es la
     única que puede cazar un desplazamiento que no sea perpendicular al tubo. */
  check('y perpendiculares al tubo: cero desvío a lo largo del eje',
        bg.desvio < 0.01, bg.desvio);
  check('y los solapes se cantan, pero no bloquean',
        bg.bif.si === true && bg.bif.solapes > 0 && /OJO/.test(bg.bif.porque || ''), bg.bif);

  const pv = await carga('polvorin');
  check('Polvorín: 119 seguidores -> 236 filas (117 bífilos + 2 mono)',
        pv.trk === 119 && pv.filas === 236, [pv.trk, pv.filas]);
  check('y 119 TCU', pv.tcus === 119, pv.tcus);
  check('y 117 bielas: los dos mono no la tienen', pv.eje.n === 117 && pv.eje.peor < 0.05, pv.eje);
  check('con sus vigas a 4,50 m: 2 x 2,25', Math.abs(pv.sep - 4.5) < 0.01, pv.sep);
  /* EL REPARTO A NCU, cuando es DERIVADO. El generador del layout no encontro
     49 de los 119 en ningun ambito de NCU dibujado y les dio la mas cercana
     (`ncuCerca`): 44 a la NCU 2 del norte y 5 del mismo bloque a la NCU 1, por
     tres metros. Un reparto asi no es un dato de proyecto, y la pagina lo
     tiene que decir en vez de pintarlo como si lo fuera. */
  const der = await page.evaluate(() => ({
    n: PLANTA.trk.filter(t => t.derivado).length,
    nota: /Ojo con el reparto:\s*49 de 119/.test(document.getElementById('note').textContent),
    lect: [...document.querySelectorAll('#lect .x')].map(e => e.textContent).filter(t => /asignados por proximidad/.test(t)).length }));
  check('49 seguidores de Polvorín llevan la NCU por PROXIMIDAD, no por ámbito dibujado', der.n === 49, der);
  check('y la página lo dice, en la nota y en el desglose de cada gateway', der.nota && der.lect === 2, der);
  check('el tipo mono se cuenta y se dice',
        pv.bif.mono === 2 && /2 de tipo mono/.test(pv.bif.porque || ''), pv.bif);

  // ── SAN JOSÉ: 2.289 seguidores, 147 sin levantar y 10 cotas imposibles ────
  console.log('\n· San José: los sin levantar en sus DOS vigas, y las cotas imposibles declaradas');
  const sj = await carga('sanjose');
  const sjx = await page.evaluate(() => {
    const UN = PLANTA._un, por = {};
    UN.forEach(f => { const k = f.trk; (por[k] = por[k] || []).push(f); });
    const solas = Object.values(por).filter(v => v.length !== 2).length;
    const sinMed = UN.filter(f => !f.med).length;
    const raras = new Set((PLANTA._raras || []).map(r => r.trk)).size;
    const u = terreno.userData, pos = terreno.geometry.attributes.position, dx = [];
    for (let k = 0; k < u.Mz; k++) for (let i = 0; i < u.Mx; i++) dx.push(Math.abs(pos.getY(k * (u.Mx + 1) + i + 1) - pos.getY(k * (u.Mx + 1) + i)) / Math.max(1, u.cols[i + 1] - u.cols[i]) * 6);
    dx.sort((a, b) => a - b);
    const seps = Object.values(por).filter(v => v.length === 2).map(v => Math.hypot(v[1].x - v[0].x, v[1].n - v[0].n)).sort((a, b) => a - b);
    return { solas, sinMed, sinCota: PLANTA.cot.sinCota.length, raras, saltoXmax: +dx[dx.length - 1].toFixed(1),
             dobles: PLANTA._dobles, sepMin: +seps[0].toFixed(2), sepMax: +seps[seps.length - 1].toFixed(2), fz: filaZde(PLANTA.lay),
             nota: /sin levantamiento, plantados en la cota de alrededor —\d+ de ellos porque su cota medida/.test(document.getElementById('note').textContent) };
  });
  check('2.289 seguidores y CADA UNO con sus dos filas: ninguna monofila', sj.trk === 2289 && sjx.solas === 0 && sj.filas === 4578, { trk: sj.trk, filas: sj.filas, solas: sjx.solas });
  check('y 2.289 TCU', sj.tcus === 2289, sj.tcus);
  check('los sin levantar van en dos vigas: 147 + 11 raros = 158 seguidores, 316 filas sin cota medida',
        sjx.sinCota === 158 && sjx.sinMed === 316, sjx);
  check('las 11 cotas imposibles del levantamiento (37 m sobre sus vecinas o entre sus dos filas) se detectan y se declaran',
        sjx.raras === 11 && sjx.nota, sjx);
  /* 183 seguidores traen sus dos filas medidas en la MISMA x (midieron el eje):
     se abren a +-filaZ con lo medido. Y con eso TODAS las parejas de la planta
     quedan a 2·filaZ (6,2 m), sin una sola fila encima de otra. */
  check('183 parejas medidas en la misma x se abren a ±filaZ (3,1 m): ninguna fila encima de otra',
        sjx.dobles === 183 && sjx.sepMin > 2 * sjx.fz - 0.5 && sjx.sepMax < 2 * sjx.fz + 1.2, sjx);
  check('y con las cotas imposibles fuera el terreno no levanta paredes: salto máximo entre columnas < 8 m (antes 106)', sjx.saltoXmax < 8, sjx.saltoXmax);

  /* ── LOS ENCUADRES, CON PLANTA PUESTA ────────────────────────────────────
     Apuntaban a rows[3], a 3*P y a ncu.pos, que son del corte de estudio: con
     una planta cargada no existen. «Antena TCU» acababa mirando un punto
     inventado POR ENCIMA de las mesas —con la antena colgando bajo la viga dos
     metros mas abajo— y «NCU» reventaba contra un ncu nulo. */
  console.log('\n· los encuadres miran al equipo de la PLANTA, no al corte de estudio');
  await carga('elburgo');
  for (const v of ['antena', 'motor']) {
    const r = await page.evaluate(vv => { frame(vv);
      const T = PLANTA._tcus;
      const hA = Math.max(0.15, HTUBE - (+document.getElementById('drop').value));
      let d = 1e9, y0 = 0;
      T.forEach(t => { const th = t.d.rot || 0;
        const x = t.d.x + Seguidor.DIMS.tcuX * Math.sin(th);
        const z = -(t.d.n + Seguidor.DIMS.tcuX * Math.cos(th));
        const q = Math.hypot(controls.target.x - x, controls.target.z - z);
        if (q < d) { d = q; y0 = t.d.y; } });
      return { cam: camera.position.toArray(), tgt: controls.target.toArray(),
               dAnt: d, yFila: y0, hA: hA, htube: HTUBE };
    }, v);
    if (v === 'antena') {
      check('«Antena TCU» apunta a una antena de verdad (a menos de 30 cm)',
            r.dAnt < 0.3, r.dAnt);
      check('y a la cota a la que CUELGA, no a la de la mesa',
            Math.abs(r.tgt[1] - (r.yFila + r.hA)) < 0.05, [r.tgt[1], r.yFila + r.hA]);
      check('con la cámara por DEBAJO del tubo: desde arriba solo se ve la mesa',
            r.cam[1] < r.yFila + r.htube, [r.cam[1], r.yFila + r.htube]);
    } else {
      check('«Accionamiento» se va a un seguidor de la planta, no al corte',
            r.dAnt < 3.5, r.dAnt);
    }
  }
  const eqf = await page.evaluate(() => {
    const o = {};
    ['ncu', 'hsu'].forEach(t => { frame(t);
      const e = PLEQ.find(q => q.tipo === t);
      const p3 = e.g.localToWorld(e.ant.clone());
      o[t] = Math.hypot(controls.target.x - p3.x, controls.target.y - p3.y, controls.target.z - p3.z);
    });
    return o;
  });
  check('«NCU» y «HSU» apuntan a SU antena, y ninguna revienta',
        eqf.ncu < 0.05 && eqf.hsu < 0.05, eqf);

  /* ── LAS PAREJAS DEDUCIDAS, DONDE CAERÍAN SI ESTUVIERAN MEDIDAS ───────────
     En San José el levantamiento da a cientos de seguidores sus dos filas con
     la MISMA x: se anotó una viga para las dos. Hay que abrirlas, y la pregunta
     es hacia dónde.

     Se abrían simétricas respecto a esa x, dando por hecho que se había medido
     el eje. No: sobre las parejas que SÍ traen sus dos vigas, el centro cae a
     −3,09 m de la x del layout (p5 −3,16 · p95 −3,03), o sea que la x del
     layout es una VIGA. Abrirlas simétricas ponía esos 183 seguidores 3,09 m
     —media distancia entre filas— al otro lado, intercalados con sus vecinos
     bien colocados. Eso es lo que se veía como «mal implantado».

     Lo que se comprueba es lo único que importa: que las DEDUCIDAS caigan donde
     caerían si estuvieran medidas. Se compara la mediana de (centro − x del
     layout) de las dos poblaciones; antes se separaban 3,09 m, que es
     exactamente el defecto.

     Y de propina, la razón por la que esto NO puede ir clavado en el código:
     Ayora da +2,98 y San José −3,09. Signos OPUESTOS. Un número a mano habría
     roto una de las dos plantas. */
  console.log('\n· Las parejas deducidas caen donde caerían las medidas');
  for (const planta of ['sanjose', 'ayora']) {
    await carga(planta);
    const r = await page.evaluate(() => {
      const filas = (PLANTA.cot && PLANTA.cot.filas) || [];
      const porTrk = {};
      filas.forEach(f => { (porTrk[f.trk] = porTrk[f.trk] || []).push(f); });
      const med = [], ded = [];
      Object.values(porTrk).forEach(v => {
        if (v.length !== 2) return;
        const t = PLANTA.trk[v[0].trk]; if (!t) return;
        const c = (v[0].x + v[1].x) / 2 - t.x;
        // una pareja DEDUCIDA quedó exactamente a 2·semi; las medidas, no
        const sep = Math.abs(v[0].x - v[1].x);
        (Math.abs(sep - 2 * PLANTA._semiMedido) < 1e-9 ? ded : med).push(c);
      });
      const mediana = a => { if (!a.length) return null; a.sort((x, y) => x - y); return a[a.length >> 1]; };
      return { medidas: med.length, deducidas: ded.length,
               mMed: mediana(med), mDed: mediana(ded),
               desp: PLANTA._despMedido, semi: PLANTA._semiMedido };
    });
    check(`${planta}: el desplazamiento se MIDE en la planta, no se asume`,
          r.desp !== null && Math.abs(r.desp) > 0.5, JSON.stringify(r));
    if (r.deducidas > 0) {
      check(`${planta}: las ${r.deducidas} deducidas caen con las ${r.medidas} medidas`,
            r.mDed !== null && r.mMed !== null && Math.abs(r.mDed - r.mMed) < 0.5,
            `mediana deducidas ${(r.mDed||0).toFixed(2)} vs medidas ${(r.mMed||0).toFixed(2)}`);
    } else {
      check(`${planta}: no tiene parejas coincidentes que deducir`, r.deducidas === 0, r.deducidas);
    }
  }
  /* El signo NO es una constante del mundo: es de cada planta. */
  {
    const sj = await carga('sanjose').then(() => page.evaluate(() => PLANTA._despMedido));
    const ay = await carga('ayora').then(() => page.evaluate(() => PLANTA._despMedido));
    check('y no es un número clavado: Ayora y San José lo tienen con signo OPUESTO',
          sj !== null && ay !== null && Math.sign(sj) !== Math.sign(ay),
          `sanjose ${sj && sj.toFixed(2)} · ayora ${ay && ay.toFixed(2)}`);
  }

  /* ── CADA TCU CONTRA EL MÁSTIL QUE ES EL SUYO ──────────────────────────────
     El margen de un seguidor se mide contra el mástil de SU (NCU, GW). Si el
     mástil se elige mal, todo el color de la planta es mentira y no se nota:
     sale un mapa plausible, solo que de otra planta.

     Aquí se pasó de largo un fallo real —el mástil se buscaba por NOMBRE— que
     mandaba 286 seguidores de Ayora y 964 de San José a un mástil ajeno, uno a
     1,7 km. Los bancos no lo veían porque las seis plantas pequeñas dan lo
     mismo por las dos reglas.

     Lo que se comprueba NO es «el mástil más cercano»: eso sería imponer el
     reparto derivado que precisamente no nos fiamos (y hay tres grupos reales
     —El Burgo 2.1, San José 4.1 y 12.1— que legítimamente NO cuelgan del más
     cercano). Se comprueba algo más débil y suficiente: que el mástil de un
     grupo cae DENTRO DEL ENTORNO de su grupo, midiendo su distancia al
     centroide en unidades del radio del propio grupo. Medido sobre las ocho
     plantas: por índice el peor cociente es 1,38; por nombre, 14,16. El listón
     va en 3, al doble de uno y a la quinta parte del otro. */
  console.log('\n· El mástil de cada (NCU, GW), en las ocho plantas');
  for (const planta of ['fayon', 'tunez', 'bagnarelli', 'polvorin',
                        'elburgo', 'paramo', 'ayora', 'sanjose']) {
    await carga(planta);
    const r = await page.evaluate(() => {
      const masts = PLEQ.filter(e => e.tipo === 'ncu');
      if (!masts.length) return { peor: 0, grupos: 0 };
      const g = new Map();
      PLANTA.trk.forEach(t => { const k = (t.ncu || 1) + '.' + (t.gw || 1);
        if (!g.has(k)) g.set(k, []); g.get(k).push(t); });
      let peor = 0, quien = null;
      for (const [k, v] of g) {
        const cx = v.reduce((a, t) => a + t.x, 0) / v.length;
        const cn = v.reduce((a, t) => a + t.n, 0) / v.length;
        const radio = Math.max(1, ...v.map(t => Math.hypot(t.x - cx, t.n - cn)));
        const m = mastilDe(+k.split('.')[0], +k.split('.')[1], masts);
        const q = Math.hypot(m.dato.x - cx, m.dato.n - cn) / radio;
        if (q > peor) { peor = q; quien = { grupo: k, mastil: m.dato.name, cociente: +q.toFixed(2) }; }
      }
      return { peor: +peor.toFixed(2), grupos: g.size, quien: quien };
    });
    check(`${planta}: los ${r.grupos} mástiles caen en el entorno de su grupo`,
          r.peor < 3, JSON.stringify(r.quien));
  }

  check('sin errores de JS en ninguna planta', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('');
  if (ko) { console.log(ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
  console.log('TODAS OK (' + ok + ' comprobaciones)');
})().catch(e => { console.error(e); process.exit(1); });
