/* LA ORTOFOTO DEL TERRENO: que llegue al suelo, y que su fallo se declare.
 *
 *   node tests/test_ortofoto.js
 *   ORTO_UV=no node tests/test_ortofoto.js   (mutación: TIENE que salir rojo)
 *
 * QUÉ SE AÑADIÓ. «¿Por qué el suelo es diferente a cobertura 3d?» Porque son dos
 * vestidos del mismo terreno, los dos a propósito: allí ortofoto, aquí un plano
 * topográfico (curvas cada metro y cada cinco). Se añade la foto SIN quitar las
 * curvas: van encima.
 *
 * LO QUE SE COMPRUEBA, Y POR QUÉ NO ES «SE DESCARGA LA FOTO». Un banco que sólo
 * mirase que el mosaico se arma pasaría con la foto cargada y el suelo igual que
 * antes — que es el defecto que la haría inútil. Así que se mira EL SUELO: que
 * su textura pase a ser la del mosaico, que las UV se recalculen (la rejilla del
 * terreno NO es uniforme en X, así que la UV de fábrica no cuadra con la foto),
 * y que los PÍXELES cambien.
 *
 * Y LA MITAD QUE MÁS IMPORTA: que cuando la foto NO se puede bajar, la página lo
 * DIGA y se quede con las curvas. La regla de esta casa es no fingir un dato que
 * no llegó; es la misma que ya sigue el relieve.
 *
 * SIN RED. Las teselas las sirve el propio banco: una imagen conocida y bien
 * distinta del suelo de siempre, para que el cambio de píxeles no sea sutil.  */
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const PW_DEV = '/opt/pw-browsers/chromium';
const PW = process.env.PW_CHROMIUM || (require('fs').existsSync(PW_DEV) ? PW_DEV : undefined);
const BASE = process.env.URL || 'http://127.0.0.1:8099/index.html';
const MUT = process.env.ORTO_UV === 'no';

let ok = 0, ko = 0;
const check = (n, c, extra) => { if (c) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

/* Tesela conocida: damero magenta/cian. No se parece a nada del suelo de esta
   página, así que si aparece en el render es porque la foto llegó de verdad. */
function tesela() {
  const p = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, q = ((x >> 5) + (y >> 5)) & 1;
    p.data[i] = q ? 230 : 20; p.data[i + 1] = q ? 20 : 220; p.data[i + 2] = q ? 210 : 230; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

(async () => {
  const TES = tesela();
  const browser = await chromium.launch({ executablePath: PW,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  /* El relieve, cortado: esta sección va del VESTIDO del terreno, y con la
     planta plana igualmente hay malla que vestir... no la hay: sin relieve la
     página usa el suelo liso y no construye terreno. Así que el DEM se sirve
     también, de una tesela plana con una rampa, para que exista malla. */
  await ctx.route('**/elevation-tiles-prod/**', r => r.fulfill({ status: 200,
    contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
    body: require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'dem_cerro.png')) }));

  // POR EXPRESIÓN REGULAR Y NO POR GLOB. Un glob de dos asteriscos, barra y
  // host exige una BARRA justo antes del host, y aquí el host es
  // `server.arcgisonline.com`: no casaba, y las teselas no se servían.
  // (Y el patrón no se puede ni escribir dentro de un comentario de bloque: su
  //  asterisco-barra lo cierra antes de tiempo. También costó un rojo.)
  const PATRONES = [/arcgisonline\.com/, /ign\.es/];
  let pedidas = 0;
  const sirveFoto = (activo) => PATRONES.map(pat =>
    ctx.route(pat, r => { pedidas++; return activo
      ? r.fulfill({ status: 200, contentType: 'image/png',
                    headers: { 'access-control-allow-origin': '*' }, body: TES })
      : r.abort(); }));

  if (MUT) await ctx.route(BASE, async r => {
    const res = await r.fetch(); const antes = await res.text();
    /* MUTACIÓN: se salta el recálculo de UV. La foto se carga igual y el suelo
       cambia de textura, pero queda MAL PUESTA sobre una rejilla no uniforme.
       Es el fallo realista, y el banco tiene que verlo. */
    const html = antes.replace('if(ORTO&&ORTO.ok){\n    const uv=g.attributes.uv;', 'if(false){\n    const uv=g.attributes.uv;');
    if (html === antes) { console.log('FAIL la mutación no encontró qué romper'); process.exit(2); }
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });

  await Promise.all(sirveFoto(true));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof cargaPlanta === 'function', null, { timeout: 60000 });
  await pg.evaluate(() => cargaPlanta('tunez'));
  /* OJO CON `window.`: `PLANTA` y `terreno` son `let` de módulo, así que se ven
     por su NOMBRE pero NO cuelgan de `window`. Preguntar por `window.terreno`
     espera para siempre por algo que nunca va a existir. */
  await pg.waitForFunction(() => { try { return !!(PLANTA && PLANTA.nom === 'tunez' && terreno); }
                                   catch (e) { return false; } }, null, { timeout: 180000 });
  await pg.waitForTimeout(1500);

  const lee = () => pg.evaluate(() => ({
    hayTerreno: !!terreno,
    uv0: terreno ? [+terreno.geometry.attributes.uv.getX(0).toFixed(4),
                    +terreno.geometry.attributes.uv.getY(0).toFixed(4)] : null,
    /* ¿las UV son las de fábrica? En un PlaneGeometry van de 0 a 1 en rejilla
       regular; las de la foto salen de la georreferencia y no lo son. */
    /* ¿UV DE FÁBRICA? El `PlaneGeometry` arranca su primer vértice en (0, 1)
       exacto; las de la foto salen de la georreferencia y no caen ahí. */
    uvFabrica: terreno ? (terreno.geometry.attributes.uv.getX(0) === 0
                       && terreno.geometry.attributes.uv.getY(0) === 1) : null,
    mapa: terreno && terreno.material.map ? (terreno.material.map.image &&
           terreno.material.map.image.width + 'x' + terreno.material.map.image.height) : 'sin mapa',
    marcada: document.getElementById('orto').checked,
    rotulo: document.getElementById('ortoEst').textContent,
  }));

  const antes = await lee();
  check('la planta tiene terreno que vestir', antes.hayTerreno, JSON.stringify(antes));
  /* El `readPixels` va DESPUÉS de un render explícito: `preserveDrawingBuffer`
     está apagado y sin eso se lee un búfer ya soltado. */
  const pix = async () => pg.evaluate(() => { renderer.render(scene, camera);
      const g = renderer.domElement.getContext('webgl2') || renderer.domElement.getContext('webgl');
      const w = 60, h = 60, px = new Uint8Array(w * h * 4);
      g.readPixels((renderer.domElement.width - w) >> 1, (renderer.domElement.height >> 1) - h,
                   w, h, g.RGBA, g.UNSIGNED_BYTE, px);
      let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] * 2 + px[i + 2] * 3;
      return s; });
  const pxAntes = await pix();

  await pg.click('#orto');
  await pg.waitForFunction(() => /teselas/.test(document.getElementById('ortoEst').textContent)
                             || /no se pudo/.test(document.getElementById('ortoEst').textContent),
                           null, { timeout: 120000 });
  await pg.waitForTimeout(1500);
  const conFoto = await lee();
  const pxFoto = await pix();

  check('con la foto servida, el interruptor se queda encendido y dice de dónde viene',
        conFoto.marcada && /teselas/.test(conFoto.rotulo), conFoto.rotulo);
  check('y el suelo pasa a llevar el mosaico, no la textura de siempre',
        conFoto.mapa !== antes.mapa, `${antes.mapa} -> ${conFoto.mapa}`);
  check('y las UV se recalculan (la rejilla no es uniforme: la de fábrica no cuadra)',
        antes.uvFabrica === true && conFoto.uvFabrica === false,
        `fábrica antes=${antes.uvFabrica} después=${conFoto.uvFabrica} · uv0 ${JSON.stringify(conFoto.uv0)}`);
  check('y los píxeles del suelo cambian de verdad', Math.abs(pxFoto - pxAntes) > 2000,
        `${pxAntes} -> ${pxFoto}`);

  /* LA MITAD QUE MÁS IMPORTA: sin teselas, se dice y se vuelve a las curvas. */
  await pg.click('#orto');                       // apagar
  await pg.waitForTimeout(600);
  await Promise.all(PATRONES.map(p => ctx.unroute(p)));
  await Promise.all(sirveFoto(false));
  await pg.click('#orto');                       // encender con el CDN caído
  await pg.waitForFunction(() => /no se pudo/.test(document.getElementById('ortoEst').textContent),
                           null, { timeout: 120000 });
  const caido = await lee();
  check('si la foto no se puede bajar, lo DICE y se apaga sola',
        !caido.marcada && /no se pudo/.test(caido.rotulo), caido.rotulo);
  check('y el suelo vuelve a su textura de siempre', caido.mapa === antes.mapa,
        `${caido.mapa} (antes ${antes.mapa})`);

  check('sin errores de JS', errs.length === 0, errs.slice(0, 3).join(' · '));
  await browser.close();

  if (MUT) { console.log(ko ? `\nMUTACIÓN OK: el banco la caza (${ko} rojo)` : '\nMUTACIÓN NO CAZADA: el banco no vale');
             process.exit(ko ? 0 : 1); }
  if (ko) { console.log(`\n${ko} FALLOS (${ok} OK)`); process.exit(1); }
  console.log(`\nTODAS OK (${ok} comprobaciones)`);
})().catch(e => { console.error(e); process.exit(1); });
