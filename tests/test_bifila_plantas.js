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
           /* SEPARACIÓN REAL entre las dos vigas de un mismo seguidor. Contar
              filas no basta: con un filaZ inventado salen las mismas 34 y en el
              sitio equivocado, que es lo que apantalla rayos que no toca. */
           sep: (() => { const d = [];
             const por = {};
             UN.forEach((f, i) => { const k = f.trk != null ? f.trk : i; (por[k] = por[k] || []).push(f); });
             Object.values(por).forEach(v => { if (v.length === 2) d.push(Math.hypot(v[1].x - v[0].x, v[1].n - v[0].n)); });
             d.sort((a, b) => a - b);
             return d.length ? +d[d.length >> 1].toFixed(3) : null; })(),
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
  check('y los solapes se cantan, pero no bloquean',
        bg.bif.si === true && bg.bif.solapes > 0 && /OJO/.test(bg.bif.porque || ''), bg.bif);

  const pv = await carga('polvorin');
  check('Polvorín: 119 seguidores -> 236 filas (117 bífilos + 2 mono)',
        pv.trk === 119 && pv.filas === 236, [pv.trk, pv.filas]);
  check('y 119 TCU', pv.tcus === 119, pv.tcus);
  check('con sus vigas a 4,50 m: 2 x 2,25', Math.abs(pv.sep - 4.5) < 0.01, pv.sep);
  check('el tipo mono se cuenta y se dice',
        pv.bif.mono === 2 && /2 de tipo mono/.test(pv.bif.porque || ''), pv.bif);

  check('sin errores de JS en ninguna planta', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('');
  if (ko) { console.log(ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
  console.log('TODAS OK (' + ok + ' comprobaciones)');
})().catch(e => { console.error(e); process.exit(1); });
