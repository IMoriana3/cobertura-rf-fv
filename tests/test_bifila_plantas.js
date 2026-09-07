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
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
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
                    await page.waitForTimeout(800); }
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
  check('las filas quedan al paso de la planta (6 m), no a 12',
        Math.abs(f.paso - 6) < 0.2, f.paso);
  check('la decisión sale del layout, no de una lista escrita a mano',
        f.bif && f.bif.si === true && /paso declarado/.test(f.bif.porque || ''), f.bif);
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
  /* Ayora TIENE filaZ y paso declarados, así que aquí la regla sí decide — y
     decide que NO. Es el caso que distingue «comprobar» de «partir siempre». */
  check('y la regla dice que Ayora no se parte, aunque pueda decidirlo',
        a.bif && a.bif.si === false && /ya quedan/.test(a.bif.porque || ''), a.bif);
  check('cada fila medida sabe de qué seguidor es', a.conTrk === true);
  check('y la TCU es la fila oeste del par', a.oeste === true);
  check('sigue teniendo el levantamiento: las filas van a su cota, no a 0',
        a.conCota === true);
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
  check('y se dice por qué no se parte', p.bif && p.bif.si === false && !!p.bif.porque, p.bif);

  // ── Y las que NO se pueden decidir, que se queden como estaban ────────────
  console.log('\n· sin paso de fila declarado no se parte: mejor quieto que inventando');
  for (const q of ['elburgo', 'tunez', 'polvorin', 'bagnarelli']) {
    const r = await carga(q);
    // tres motivos legítimos, y los tres tienen que decirse: sin filaZ, sin paso
    // declarado (los layouts de este repo son copias recortadas), o que sin
    // partir ya quedan al paso.
    check(q + ': no se parte, y dice el motivo',
          r.bif && r.bif.si === false &&
          /no declara filaZ|no declara el paso|ya quedan/.test(r.bif.porque || ''),
          r.bif);
    check(q + ': una TCU por seguidor', r.tcus === r.trk, [r.tcus, r.trk]);
  }

  /* ── un levantamiento INCOMPLETO ──────────────────────────────────────────
     Las dos guardas del emparejamiento —la tolerancia y el "no repetir"— son
     defensivas: en Ayora todo casa y no se notan. Aquí se sirve un
     levantamiento recortado, que es lo que pasa cuando el DWG se mide antes de
     una ampliación, y entonces sí tienen que hacer su trabajo:
       · sin tolerancia, un seguidor sin entrada se lleva la de 300 m más allá;
       · sin "no repetir", dos seguidores comparten la misma fila y uno se
         coloca donde no está. */
  console.log('\n· con el levantamiento a medias, el emparejamiento no inventa');
  const CORTE = 400;
  await page.route('**/ayora_cotas.json', async route => {
    const r = await route.fetch();
    const j = JSON.parse(await r.text());
    j.t = j.t.slice(0, CORTE);              // solo los primeros: el resto se queda sin medir
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(j) });
  });
  const inc = await carga('ayora');
  /* 751 seguidores y 400 entradas servidas, pero solo 397 emparejan: TRES de
     las 400 son las de TK 040-05, TK 050-05 y TK 051-05 —índices 315, 325 y
     326 del levantamiento original— cuyas TCU se retiraron y ya no están en el
     layout. Que se queden sin pareja es exactamente lo que tiene que pasar, y
     es la prueba de que el emparejamiento va por SITIO y no por orden. */
  check('los que no tienen entrada se quedan sin ella, y se cuentan',
        inc.empar && inc.empar.lejos === inc.empar.n - (CORTE - 3),
        inc.empar);
  check('y las tres entradas de las TCU retiradas no las coge nadie',
        inc.empar && inc.empar.n - inc.empar.lejos === CORTE - 3,
        inc.empar && (inc.empar.n - inc.empar.lejos));
  check('ninguno se lleva una fila que no es suya',
        inc.empar && inc.empar.dmax < 4, inc.empar && inc.empar.dmax);
  check('y ninguna entrada se reparte entre dos',
        inc.empar && inc.empar.repetidas === 0, inc.empar);
  check('los medidos conservan su cota; el resto va al terreno, no se pierde',
        inc.trk === 751 && inc.tcus === 751, inc);
  await page.unroute('**/ayora_cotas.json');

  check('sin errores de JS en ninguna planta', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('');
  if (ko) { console.log(ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
  console.log('TODAS OK (' + ok + ' comprobaciones)');
})().catch(e => { console.error(e); process.exit(1); });
