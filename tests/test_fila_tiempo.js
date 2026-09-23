/* LA HORA, EN SU PROPIA FILA Y FUNCIONANDO.
 *
 *   node tests/test_fila_tiempo.js
 *   FILA_TIEMPO=viejo node tests/test_fila_tiempo.js   (mutación: TIENE que salir rojo)
 *
 * QUÉ PASABA. La hora es la variable que se toca todo el rato —mueve el sol, las
 * mesas y con ellas los márgenes— y era UN DESLIZADOR MÁS entre diez, a saltos
 * de 5 minutos, con su botón de reproducir en otro sitio del panel. Pedido:
 * «replicar slider temporal como en difusa, más claro, ahora está diluido entre
 * el resto».
 *
 * LO QUE SE COMPRUEBA, Y POR QUÉ NO ES «EXISTE UNA FILA». Un banco que mirase
 * que hay un `<div class="timerow">` pasaría con la fila puesta y los controles
 * muertos — que es EXACTAMENTE el riesgo de mover un control de sitio: el ▶
 * tenía su manejador dentro del grupo `#segp` y al subirlo se habría quedado
 * mudo. Así que se pulsa el botón de verdad y se mira si el reloj AVANZA, y se
 * arrastra el deslizador y se mira si el sol se entera.
 */
const { chromium } = require('playwright');
/* La misma regla que el resto de bancos de este repo: la ruta del contenedor
   solo si EXISTE, y si no `undefined` — que es como se le dice a Playwright
   «usa el navegador que te instalaste tú», que es lo que pasa en CI. */
const PW_DEV = '/opt/pw-browsers/chromium';
const PW = process.env.PW_CHROMIUM || (require('fs').existsSync(PW_DEV) ? PW_DEV : undefined);
const BASE = process.env.URL || 'http://127.0.0.1:8099/index.html';
const MUT = process.env.FILA_TIEMPO === 'viejo';

let ok = 0, ko = 0;
const check = (n, c, extra) => { if (c) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: PW,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/elevation-tiles-prod/**', r => r.abort());

  /* MUTACIÓN: se devuelve el paso de 5 minutos del deslizador y se le quita al ▶
     su oyente propio (que es lo que pasaría si se hubiera movido el botón sin
     acordarse del manejador). Se rompe el código, no se apaga el banco. */
  if (MUT) await ctx.route(BASE, async r => {
    const res = await r.fetch(); const antes = await res.text();
    let html = antes.replace('<input id="hora" type="range" min="0" max="1439" step="1"',
                             '<input id="hora" type="range" min="0" max="1439" step="5"');
    html = html.replace('$("play").addEventListener("click",()=>{', '(()=>{');
    if (html === antes) { console.log('FAIL la mutación no encontró qué romper'); process.exit(2); }
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });

  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof update === 'function', { timeout: 60000 });
  await pg.waitForTimeout(800);

  /* 1. LA FILA ESTÁ, Y LOS CONTROLES DENTRO. Es la parte barata; sola no bastaría. */
  const sitio = await pg.evaluate(() => {
    const f = document.querySelector('.timerow');
    const dentro = id => !!(f && f.querySelector('#' + id));
    const vista = document.getElementById('view');
    return { hay: !!f, hora: dentro('hora'), play: dentro('play'), speed: dentro('speed'),
             lbl: dentro('vHora'),
             /* pegada a la escena: la fila va DESPUÉS de la vista 3D y antes del panel */
             trasVista: !!(f && vista && (vista.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)),
             paso: +document.getElementById('hora').step,
             /* y ya NO cuelga de la rejilla de deslizadores */
             enGrid: !!(document.getElementById('hora').closest('.grid')) };
  });
  check('la hora tiene su propia fila, pegada a la escena y fuera de la rejilla',
        sitio.hay && sitio.hora && sitio.play && sitio.speed && sitio.lbl
          && sitio.trasVista && !sitio.enGrid, JSON.stringify(sitio));
  check('y va a paso de 1 minuto, no de 5', sitio.paso === 1, `step=${sitio.paso}`);

  /* 2. EL ▶ MUEVE EL RELOJ DE VERDAD. Aquí es donde caería un botón huérfano. */
  await pg.evaluate(() => { document.getElementById('hora').value = 600;
                            document.getElementById('hora').dispatchEvent(new Event('input')); });
  await pg.waitForTimeout(300);
  const antes = await pg.evaluate(() => +document.getElementById('hora').value);
  await pg.click('#play');
  await pg.waitForTimeout(1500);
  const corriendo = await pg.evaluate(() => +document.getElementById('hora').value);
  await pg.click('#play');
  await pg.waitForTimeout(400);
  const parado = await pg.evaluate(() => +document.getElementById('hora').value);
  await pg.waitForTimeout(900);
  const sigueParado = await pg.evaluate(() => +document.getElementById('hora').value);

  check('el ▶ hace avanzar el reloj', corriendo > antes, `${antes} -> ${corriendo}`);
  check('y la ⏸ lo para de verdad', sigueParado === parado, `${parado} -> ${sigueParado}`);

  /* 3. Y LA HORA SIGUE MANDANDO EN LA FÍSICA: mover el deslizador mueve el sol.
     Sin esto, una fila preciosa podría estar desconectada del cálculo. */
  const sol = async () => pg.evaluate(() => ({ y: +sun.position.y.toFixed(2), x: +sun.position.x.toFixed(2) }));
  await pg.evaluate(() => { document.getElementById('hora').value = 420;
                            document.getElementById('hora').dispatchEvent(new Event('input')); });
  await pg.waitForTimeout(400); const s1 = await sol();
  await pg.evaluate(() => { document.getElementById('hora').value = 720;
                            document.getElementById('hora').dispatchEvent(new Event('input')); });
  await pg.waitForTimeout(400); const s2 = await sol();
  check('mover la hora mueve el sol (la fila manda en la física)',
        s2.y > s1.y + 1, `07:00 ${JSON.stringify(s1)} · 12:00 ${JSON.stringify(s2)}`);
  const etiqueta = await pg.evaluate(() => document.getElementById('vHora').textContent.trim());
  check('y el reloj de la fila lo dice', etiqueta === '12:00', etiqueta);

  check('sin errores de JS', errs.length === 0, errs.slice(0, 3).join(' · '));
  await browser.close();

  if (MUT) { console.log(ko ? `\nMUTACIÓN OK: el banco la caza (${ko} rojo)` : '\nMUTACIÓN NO CAZADA: el banco no vale');
             process.exit(ko ? 0 : 1); }
  if (ko) { console.log(`\n${ko} FALLOS (${ok} OK)`); process.exit(1); }
  console.log(`\nTODAS OK (${ok} comprobaciones)`);
})().catch(e => { console.error(e); process.exit(1); });
