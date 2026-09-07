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

  /* TODAS SON BÍFILAS SALVO DONDE EL LAYOUT DIGA OTRA COSA. Eso NO se deduce de
     la retícula: lo declara el layout, y es lo que hace `terreno.html`, que
     lleva dibujando estas plantas bien desde el principio. Inferirlo —midiendo
     si al partir el paso se quedaba en la mitad— acertaba en unas y fallaba en
     otras: dejaba Túnez y Polvorín de una fila cuando son bífilos. */
  console.log('\n· Túnez: 19 seguidores -> 38 filas');
  const tz = await carga('tunez');
  check('19 seguidores -> 38 filas', tz.trk === 19 && tz.filas === 38, [tz.trk, tz.filas]);
  check('y 19 TCU', tz.tcus === 19, tz.tcus);

  /* DOS VIGAS NO PUEDEN ESTAR EN EL MISMO SITIO, y esto es lo que impide
     rematar Bagnarelli y Polvorín. Son bífilos —lo dice el layout y lo dice
     quien conoce la planta— pero sus unidades están a 1,84 m y a 0,01 m unas de
     otras, menos que su propio paso de fila: partirlas a ±filaZ pondría filas
     ENCIMA de otras, y una fila de más apantalla un rayo que en realidad pasa.
     Eso es peor que dejarlo como está, así que no se parte y se dice por qué.
     Lo que falta es un dato: el paso de fila de esas dos plantas, o su
     levantamiento. */
  console.log('\n· las que no se pueden partir sin solapar filas: se dice, no se disimula');
  for (const [q, trk] of [['bagnarelli', 17], ['polvorin', 119]]) {
    const r = await carga(q);
    check(q + ': se queda en ' + trk + ' filas, sin solapar nada',
          r.trk === trk && r.filas === trk, [r.trk, r.filas]);
    check(q + ': y dice que ES bífilo y qué dato falta',
          r.bif && r.bif.si === false && r.bif.solapes > 0 &&
          /es bífilo/.test(r.bif.porque || '') && /Falta el paso de fila/.test(r.bif.porque || ''),
          r.bif);
  }

  /* EL TIPO «MONO» NO SE PRUEBA SOLO. Hoy la unica planta que lo trae —Polvorin—
     se queda sin partir por la guarda de solapes, asi que el filtro por tipo no
     llega a actuar nunca y ninguna mutacion lo alcanzaba: codigo muerto. Se
     fuerza la decision para recorrer esa rama, que es la que servira el dia que
     Polvorin traiga su paso de fila. */
  console.log('\n· el filtro por tipo, forzando la rama que hoy no se recorre');
  const mono = await page.evaluate(() => {
    const antes = PLANTA.bif;
    PLANTA.bif = { si: true, fz: 2.25 };
    PLANTA._un = null;
    const con = unidades().length;
    const conMono = PLANTA.trk.filter(t => { const q = tipoBlq(PLANTA.lay, t); return q && q.mono; }).length;
    PLANTA.bif = antes; PLANTA._un = null; PLANTA._tcus = null;
    return { con: con, trk: PLANTA.trk.length, mono: conMono };
  });
  check('Polvorín tiene 2 seguidores de tipo mono', mono.mono === 2, mono);
  check('y al partir salen 236 filas, no 238: los dos mono van de una',
        mono.con === 2 * mono.trk - mono.mono, mono);

  check('sin errores de JS en ninguna planta', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('');
  if (ko) { console.log(ko + ' FALLOS (' + ok + ' OK)'); process.exit(1); }
  console.log('TODAS OK (' + ok + ' comprobaciones)');
})().catch(e => { console.error(e); process.exit(1); });
