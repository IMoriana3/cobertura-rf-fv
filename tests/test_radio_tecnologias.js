/* EL MANDO DE RADIO YA NO ES UNA POTENCIA: ES UNA TECNOLOGÍA.
 *
 * Hasta el 2026-10-04 el mando «Radio» de `index.html` tenía dos botones
 * escritos a mano en el HTML —`data-p="8"` y `data-p="19"`— y lo único que
 * movían era la potencia. La frecuencia estaba fija a 2,45 GHz en tres sitios y
 * la sensibilidad era un `const SENS=-103`. O sea que la página NO SABÍA QUÉ ES
 * UNA TECNOLOGÍA, y por eso LoRa no podía estar: no le faltaba un botón, le
 * faltaba el concepto.
 *
 * Y esos tres números eran una TERCERA COPIA de lo que ya estaba en el
 * `defaultParams()` del canon y en `radio_params.json` de siting. Copias sin
 * careo es la avería que documenta `lib/canon.lock.json`.
 *
 * Lo que este banco vigila, y cada regla con su mutación:
 *
 *   1. el mando sale de la TABLA        · ni un número de radio escrito en el HTML
 *   2. un hueco NO se ofrece            · sin balance completo, la variante no sale
 *   3. la frecuencia MANDA              · λ y el patrón siguen a la tecnología
 *   4. un escenario se ROTULA           · no se lee como medida
 *
 * CORRE EL VISOR DE VERDAD en Chromium, porque lo que se comprueba es lo que
 * hace la página, no lo que dice su fuente. Sin navegador sale con rc = 2 —NO
 * con verde—, que es la regla de esta cartera.
 *
 *     node tests/test_radio_tecnologias.js
 *     MUTA=<clave> node tests/test_radio_tecnologias.js      (TIENE que salir rojo)
 *
 * rc = 0 mide · 1 rojo · 2 no comprobado
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..');
/* El canon de la física, para no reimplementar ni una primitiva aquí. */
const RPV = require(path.join(RAIZ, 'lib', 'radio_pv_model.js'));
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? '  -> ' + extra : '')); }
};

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // vuelve a ofrecer variantes sin balance completo: Wi-SUN, que tiene TODO a
  // null, aparecería en el mando con `undefined` por sensibilidad.
  ofreceHuecos: ['index.html',
    'if (id.startsWith("_") || !balanceCompleto(v)) continue;',
    'if (id.startsWith("_")) continue;'],
  // la longitud de onda deja de seguir a la frecuencia: el patrón del dipolo se
  // dibuja a 2,4 GHz aunque el mando diga 868 MHz.
  lambdaNoSigue: ['index.html',
    'LAM = Z.wavelength(r.fHz);     // la longitud de onda SIGUE a la frecuencia',
    'LAM = Z.wavelength();          // la longitud de onda SIGUE a la frecuencia'],
  // el balance deja de tomar la frecuencia de la tecnología elegida
  frecuenciaFija: ['index.html',
    'p.fHz=RADIO.fHz; p.gtxDbi=RADIO.gtxDbi;',
    'p.gtxDbi=RADIO.gtxDbi;'],
  // el escenario deja de ir rotulado: su columna se lee como una medida
  escenarioMudo: ['index.html',
    'escenario: v.procedencia === "escenario_de_referencia",',
    'escenario: false,'],
};

const MUTA = process.env.MUTA;
let restaurar = null;
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('MUTA desconocida: ' + MUTA + ' (hay: ' + Object.keys(MUTACIONES).join(', ') + ')'); process.exit(2); }
  const f = path.join(RAIZ, m[0]);
  const antes = fs.readFileSync(f, 'utf8');
  if (!antes.includes(m[1])) {
    console.error('la mutación «' + MUTA + '» no encaja en ' + m[0] + ': el texto a sustituir ya no está.');
    console.error('NO se ha medido nada. Arregla la mutación o el banco.');
    process.exit(2);
  }
  fs.writeFileSync(f, antes.replace(m[1], m[2]));
  restaurar = () => fs.writeFileSync(f, antes);
  console.log('── MUTADO: ' + MUTA + ' (' + m[0] + ') — este banco TIENE que salir rojo ──\n');
}
let servidor = null;
function fin(rc) {
  if (restaurar) restaurar();
  if (servidor) try { servidor.close(); } catch (e) {}
  if (rc === 2) process.exit(2);
  console.log('\n' + ok + ' ok · ' + ko + ' fail');
  if (ko > 0) { console.log('ROJO'); process.exit(1); }
  console.log('MIDE'); process.exit(0);
}
function noComprobado(porque) {
  console.error('\nNO SE HA MEDIDO NADA: ' + porque);
  console.error('Esto NO es un verde. rc = 2.');
  fin(2);
}

/* ── UN SERVIDOR, PORQUE `fetch()` NO VA SOBRE file:// ──────────────────── */
const TIPOS = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.css':'text/css', '.png':'image/png', '.glb':'model/gltf-binary' };
function levanta() {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(RAIZ, u === '/' ? 'index.html' : u.replace(/^\//, ''));
      if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.statusCode = 404; return rsp.end('no'); }
      rsp.setHeader('Content-Type', TIPOS[path.extname(f)] || 'application/octet-stream');
      fs.createReadStream(f).pipe(rsp);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { noComprobado('no hay playwright: este banco abre el visor de verdad y lo necesita.'); }
  /* LA RUTA DEL NAVEGADOR, con el mismo criterio que el resto de los bancos de
     este repo (`test_imagen.js`): la variable si está, el Chromium del
     contenedor si existe, y si no NADA —para que Playwright use el suyo—. No se
     clava la ruta del contenedor como valor por defecto: en un runner eso mata
     el banco en un segundo sin comprobar nada. */
  const PW_DEV = '/opt/pw-browsers/chromium';
  const EXEC = process.env.PW_CHROMIUM || (fs.existsSync(PW_DEV) ? PW_DEV : undefined);

  try { servidor = await levanta(); }
  catch (e) { noComprobado('no se ha podido levantar el servidor: ' + e.message); }
  const base = 'http://127.0.0.1:' + servidor.address().port;

  let nav;
  try { nav = await chromium.launch({ executablePath: EXEC }); }
  catch (e) { noComprobado('no arranca Chromium: ' + e.message); }

  const pag = await nav.newPage();
  const errores = [];
  pag.on('pageerror', e => errores.push(String(e)));
  try {
    await pag.goto(base + '/index.html', { waitUntil: 'load', timeout: 60000 });
    /* se espera a que el mando esté pintado con la tabla, no a un tiempo fijo */
    await pag.waitForFunction(
      () => { const c = document.getElementById('segr');
              return c && c.children.length && !/cargando/.test(c.textContent); },
      null, { timeout: 30000 });
  } catch (e) {
    await nav.close();
    noComprobado('el visor no ha llegado a pintar el mando de radio: ' + e.message);
  }

  const leeMando = () => pag.evaluate(() => ({
    botones: [...document.querySelectorAll('#segr button')].map(b => ({
      id: b.dataset.p || null, txt: b.textContent.trim(),
      on: b.classList.contains('on'), title: b.title || '',
    })),
    /* `RADIOS`, `RADIO` y `LAM` son `let` de nivel superior en un script clásico:
       NO cuelgan de `window`, viven en el entorno léxico global. Se leen por su
       nombre a pelo, que es donde están. (Buscarlos en `window` daba `[]` y el
       banco se quejaba de la página teniendo razón la página.) */
    radios: (typeof RADIOS !== 'undefined' ? RADIOS : []).map(r => ({
      id: r.id, fHz: r.fHz, ptx: r.ptxDbm, sens: r.rxSensDbm, esc: !!r.escenario })),
    sel: (typeof RADIO !== 'undefined' && RADIO) ? { id: RADIO.id, fHz: RADIO.fHz } : null,
    lam: typeof LAM !== 'undefined' ? LAM : null,
  }));

  /* ── 1 · EL MANDO SALE DE LA TABLA ───────────────────────────────────── */
  const m0 = await leeMando();
  check('el visor carga sin errores de página', errores.length === 0, errores[0]);
  check('el mando tiene botones', m0.botones.length >= 2, m0.botones.length);
  check('ninguno lleva una potencia escrita como identificador (era data-p="8"/"19")',
        m0.botones.every(b => b.id && !/^\d+$/.test(b.id)),
        JSON.stringify(m0.botones.map(b => b.id)));
  check('los identificadores son los de la tabla',
        m0.botones.every(b => m0.radios.some(r => r.id === b.id)),
        JSON.stringify(m0.botones.map(b => b.id)));
  check('y el HTML ya no trae las dos opciones escritas a mano',
        !/data-p="8"|data-p="19"/.test(fs.readFileSync(path.join(RAIZ,'index.html'),'utf8')));

  /* ── 2 · UN HUECO NO SE OFRECE ───────────────────────────────────────── */
  const tabla = JSON.parse(fs.readFileSync(path.join(RAIZ, 'lib', 'radio_params.json'), 'utf8')).tecnologias;
  const completas = Object.entries(tabla).filter(([k, v]) => !k.startsWith('_') &&
        v.f_hz != null && v.ptx_dbm != null && v.gtx_dbi != null && v.grx_dbi != null && v.rx_sens_dbm != null)
        .map(([k]) => k);
  const incompletas = Object.entries(tabla).filter(([k, v]) => !k.startsWith('_') &&
        !(v.f_hz != null && v.ptx_dbm != null && v.gtx_dbi != null && v.grx_dbi != null && v.rx_sens_dbm != null))
        .map(([k]) => k);
  check('hay variantes INCOMPLETAS con las que medir la regla (si no, no prueba nada)',
        incompletas.length >= 1, JSON.stringify(incompletas));
  check('el mando ofrece EXACTAMENTE las completas',
        m0.radios.length === completas.length && completas.every(c => m0.radios.some(r => r.id === c)),
        JSON.stringify([m0.radios.map(r => r.id), completas]));
  for (const k of incompletas) {
    check('  «' + k + '» NO se ofrece, porque le falta balance',
          !m0.radios.some(r => r.id === k));
  }
  check('ninguna de las ofrecidas trae un undefined en el balance',
        m0.radios.every(r => Number.isFinite(r.fHz) && Number.isFinite(r.ptx) && Number.isFinite(r.sens)),
        JSON.stringify(m0.radios));

  /* ── 3 · LA FRECUENCIA MANDA ─────────────────────────────────────────── */
  const lora = m0.radios.find(r => /lora/i.test(r.id));
  check('LoRa está entre las ofrecidas, que es lo que se pedía', !!lora,
        JSON.stringify(m0.radios.map(r => r.id)));
  if (lora) {
    check('  y a 868 MHz, no a 2,4 GHz', lora.fHz > 8.5e8 && lora.fHz < 8.8e8, lora.fHz);
    const lamAntes = m0.lam;
    await pag.click(`#segr button[data-p="${lora.id}"]`);
    await pag.waitForFunction(id2 => typeof RADIO !== 'undefined' && RADIO && RADIO.id === id2, lora.id, { timeout: 15000 });
    const m1 = await leeMando();
    check('  al elegirla, la seleccionada cambia', m1.sel && m1.sel.id === lora.id, JSON.stringify(m1.sel));
    check('  y la LONGITUD DE ONDA la sigue', Math.abs(m1.lam - lamAntes) > 0.1,
          'λ ' + lamAntes.toFixed(3) + ' -> ' + m1.lam.toFixed(3));
    /* λ = c/f : a 868 MHz son ~0,345 m y a 2,45 GHz ~0,122 m */
    /* LA λ ESPERADA SALE DEL CANON, NO DE UNA CUENTA DE AQUÍ. Escribir
       `299792458 / f` en este banco sería una segunda copia de una primitiva, y
       `test_canon_pin.py` lo caza —lo cazó—: la física va escrita UNA vez. */
    check('  y vale lo que el canon dice para 868 MHz (~0,345 m)',
          Math.abs(m1.lam - RPV.longitudOnda(lora.fHz)) < 1e-9, m1.lam);
    /* el balance que la página usa de verdad */
    const p = await pag.evaluate(() => { const q = (typeof params === "function") ? params() : null;
      return q ? { fHz: q.fHz, ptx: q.ptxDbm, sens: q.rxSensDbm, gtx: q.gtxDbi } : null; })
      .catch(() => null);
    if (p) {
      check('  y el BALANCE que calcula la página usa esa frecuencia', Math.abs(p.fHz - lora.fHz) < 1,
            p.fHz);
      check('  y esa sensibilidad', Math.abs(p.sens - lora.sens) < 1e-9, p.sens);
    } else {
      check('  el balance de la página es legible desde el banco', false, 'params() no accesible');
    }
  }

  /* ── 4 · UN ESCENARIO SE ROTULA ──────────────────────────────────────── */
  const escs = m0.radios.filter(r => r.esc);
  check('la tabla trae al menos un escenario de referencia (si no, esto no mide)',
        escs.length >= 1, escs.length);
  for (const e of escs) {
    const b = m0.botones.find(x => x.id === e.id);
    check('  el botón de «' + e.id + '» se marca como referencia', b && /ref\./.test(b.txt),
          b && b.txt);
  }
  const txt = await pag.evaluate(() => document.body.innerText);
  if (lora && lora.esc) {
    check('  y la página dice que NO es una configuración elegida',
          /NO una configuración elegida|escenario de referencia/i.test(txt));
    check('  y que la sensibilidad es la COTA DEL CHIP',
          /COTA DEL CHIP/i.test(txt));
  }

  await nav.close();
  fin(0);
})().catch(e => { console.error('el banco se ha roto: ' + (e && e.stack || e)); fin(2); });
