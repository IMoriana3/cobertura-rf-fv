/* Banco de la vista en planta — el CAMPO, no la física.
 *
 * La física es del núcleo (`web/zigbee_pv_model.js`) y tiene su propio banco.
 * Lo que se comprueba aquí es lo que la página aporta: QUÉ obstáculos ve cada
 * enlace. Antes se enumeraba `x = k·pitch` entre los dos extremos —filas
 * infinitas en `y`, sin azimut y sin calles— y ahora se resuelve por corte de
 * segmentos contra un campo de filas finitas.
 *
 * El bloque `CAMPO` se EXTRAE del HTML real en cada ejecución, nunca se copia:
 * una copia carearía una versión vieja mientras la página evoluciona. Es el
 * mismo patrón que `tests/test_visor_3d.js`.
 *
 *     node tests/test_demo_cobertura.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra ? '  -> ' + extra : '')); }
};
const casi = (a, b, tol, n) => check(n + '  (' + a.toFixed(2) + ' vs ' + b.toFixed(2) + ')',
                                     Math.abs(a - b) <= tol);

// ── 1) el núcleo, y la página tiene que consumirlo ──────────────────────
const Z = require(path.join(RAIZ, 'web', 'zigbee_pv_model.js'));
const html = fs.readFileSync(path.join(RAIZ, 'web', 'demo-cobertura.html'), 'utf8');

check('la página CARGA el núcleo en vez de reimplantarlo',
  /<script src="zigbee_pv_model\.js"><\/script>/.test(html));
check('...y no se define un ZigbeePV propio',
  !/g\.ZigbeePV\s*=|window\.ZigbeePV\s*=/.test(html),
  'ha vuelto una copia inline del modelo');
check('...ni un presupuesto de enlace paralelo',
  !/ptxDbm:\s*18\b/.test(html), 'ptx 18 dBm es el del modelo viejo; el núcleo da 19');

// ── 2) extraer el bloque CAMPO del HTML de verdad ───────────────────────
const m = html.match(/CAMPO — inicio[\s\S]*?\*\/([\s\S]*?)\/\* ═+ CAMPO — fin/);
check('el bloque CAMPO está delimitado en el HTML', !!m);
if (!m) { console.log('\nFALLOS: ' + ko); process.exit(1); }
check('el bloque extraído tiene tamaño (el vacío es error, no PASS)',
  m[1].split('\n').length > 40, m[1].split('\n').length + ' líneas');

const ctx = { console, window: { ZigbeePV: Z }, Math };
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const { campo, corte, mesasCruzadas } = ctx;
check('el bloque exporta campo/corte/mesasCruzadas',
  !!(campo && corte && mesasCruzadas));

// ── 3) el corte de segmentos ────────────────────────────────────────────
check('dos segmentos que se cruzan dan t en (0,1)',
  Math.abs(corte(0, 0, 10, 0, 5, -1, 5, 1) - 0.5) < 1e-9);
check('paralelos NO se cortan', corte(0, 0, 10, 0, 0, 1, 10, 1) === null);
check('el corte fuera del segmento no cuenta',
  corte(0, 0, 10, 0, 20, -1, 20, 1) === null);
check('tocar el extremo del enlace no cuenta (t=0)',
  corte(0, 0, 10, 0, 0, -1, 0, 1) === null,
  'una fila bajo la propia antena no es un obstáculo del enlace');

// ── 4) el campo: filas finitas, azimut y calles ─────────────────────────
const W = 420, H = 220, PITCH = 7, BLK = 60, ST = 6;
const banda = Z.tableBand(0, 1.5, 2.38, 30, 0.06);
const filas0 = campo(W, H, PITCH, 0, BLK, ST);
check('el campo produce filas', filas0.length > 0, filas0.length + ' segmentos');
check('cada fila mide el largo de bloque', filas0.every(f =>
  Math.abs(Math.hypot(f.bx - f.ax, f.by - f.ay) - BLK) < 1e-6));

// con azimut 0 las filas corren en `y`: un enlace en `x` las cruza
const cruzaX = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 120, my: H / 2 }, filas0, banda);
check('a azimut 0, un enlace en X cruza filas (' + cruzaX.length + ')', cruzaX.length > 0);

// ...y uno EN LA MISMA dirección que las filas no cruza ninguna
const enY = mesasCruzadas({ mx: 40, my: 40 }, { mx: 40, my: 180 }, filas0, banda);
check('un enlace PARALELO a las filas no cruza ninguna (' + enY.length + ')',
  enY.length === 0, 'el paralelo no puede difractar contra canto');

// ── 5) la calle: el hallazgo que esta página existe para enseñar ────────
// Sin calle el campo es continuo; con calle hay huecos por donde salir.
const sinCalle = campo(W, H, PITCH, 0, BLK, 0);
const conCalle = campo(W, H, PITCH, 0, BLK, ST);
const nSin = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 300, my: H / 2 }, sinCalle, banda).length;
const nCon = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 300, my: H / 2 }, conCalle, banda).length;
check('la calle QUITA mesas del camino (' + nSin + ' -> ' + nCon + ')', nCon < nSin);

// un enlace que baja POR la calle transversal no cruza nada
const paso = BLK + ST;
const yCalle = H / 2 - BLK / 2 - ST / 2;     // centro del hueco entre bloques
const porCalle = mesasCruzadas({ mx: 20, my: yCalle }, { mx: 400, my: yCalle }, conCalle, banda);
check('bajar POR la calle no cruza ninguna mesa (' + porCalle.length + ')',
  porCalle.length === 0,
  'si esto falla, la calle está dibujada pero no existe para la física');

// ── 6) azimut: girar el campo cambia quién bloquea ──────────────────────
const filas90 = campo(W, H, PITCH, 90, BLK, ST);
const eX90 = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 120, my: H / 2 }, filas90, banda).length;
const eY90 = mesasCruzadas({ mx: W / 2, my: 30 }, { mx: W / 2, my: 190 }, filas90, banda).length;
check('a 90° se INVIERTE: el enlace en X deja de cruzar (' + cruzaX.length + ' -> ' + eX90 + ')',
  eX90 === 0);
check('...y el enlace en Y pasa a cruzar (' + eY90 + ')', eY90 > 0);

// ── 7) la REGRESIÓN que motivó todo: el slider de antena era inerte ─────
// `h` se usaba a la vez como altura de antena y como altura del eje del tubo,
// así que la mesa subía con la antena y el rayo no la libraba nunca: medido,
// 0,3 dB sobre todo el recorrido del slider cuando debía mover decenas.
//
// El régimen importa, y me costó una vuelta: con el eje fijo la curva NO es
// monótona, es una U — el rayo libra por DEBAJO del canto bajo, se hunde
// mientras la antena está DENTRO de la banda, y vuelve a librar por ENCIMA
// del canto alto. Mi primera versión comparó 0,5 m con 3,0 m, que libran las
// dos: 61,3 contra 61,6 dB. Medía donde la distinción no existe, que es el
// corolario 2 de la casa aplicado al dato.
const p = Z.defaultParams();
function margen(hAnt, hEje) {
  const f = campo(W, H, PITCH, 0, 1000, 0);          // campo continuo, sin calles
  const b = Z.tableBand(0, hEje, 2.38, 30, 0.06);
  const tabs = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 61, my: H / 2 }, f, b);
  return { m: Z.predictLink({ x: 40, y: H / 2, ground: 0, h: hAnt },
                            { x: 61, y: H / 2, ground: 0, h: hAnt },
                            p, null, null, tabs).marginDb, n: tabs.length };
}
const BANDA = Z.tableBand(0, 1.5, 2.38, 30, 0.06);   // bot 0,957 · top 2,147
const debajo = margen(0.5, 1.5), dentro = margen(1.5, 1.5), encima = margen(3.0, 1.5);
check('la antena DENTRO de la banda es el caso malo ' +
      '(' + debajo.m.toFixed(1) + ' / ' + dentro.m.toFixed(1) + ' / ' + encima.m.toFixed(1) + ' dB)',
  dentro.m < debajo.m - 20 && dentro.m < encima.m - 20,
  'la curva debe ser una U: librar por debajo, hundirse dentro, librar por encima');
check('...y 1,5 m cae DENTRO de la banda, que es lo que lo hace el caso malo',
  1.5 > BANDA.bot && 1.5 < BANDA.top,
  'bot=' + BANDA.bot.toFixed(3) + ' top=' + BANDA.top.toFixed(3));
check('el slider de antena NO es inerte: mueve ' +
      (Math.max(debajo.m, encima.m) - dentro.m).toFixed(1) + ' dB (antes 0,3)',
  Math.max(debajo.m, encima.m) - dentro.m > 25);
check('...y no cambia la geometría del campo (' + debajo.n + ' = ' + encima.n + ')',
  debajo.n === encima.n, 'la altura de antena no puede mover las mesas');

// y el EJE es un mando distinto: con la antena quieta a 1,5 m, subir el eje
// levanta la placa por encima de ella y el rayo pasa por debajo.
const ejeBajo = margen(1.5, 0.8), ejeAlto = margen(1.5, 2.5);
check('el eje del tubo es un mando INDEPENDIENTE y también mueve ' +
      (ejeAlto.m - ejeBajo.m).toFixed(1) + ' dB',
  Math.abs(ejeAlto.m - ejeBajo.m) > 10);
check('...subirlo aleja la placa de una antena a 1,5 m y MEJORA ' +
      '(' + ejeBajo.m.toFixed(1) + ' -> ' + ejeAlto.m.toFixed(1) + ' dB)',
  ejeAlto.m > ejeBajo.m,
  'con el eje a 2,5 la banda arranca en 1,96: la antena a 1,5 pasa por debajo');

// ── 8) la banda, no el muro ─────────────────────────────────────────────
// Con la antena por debajo del canto bajo el rayo pasa POR ABAJO. El modelo
// viejo (muro desde el suelo hasta la cresta) lo daba por tapado.
const b30 = Z.tableBand(0, 1.5, 2.38, 30, 0.06);
check('la mesa es una placa entre dos cotas, no un muro (bot=' +
      b30.bot.toFixed(2) + ' > 0)', b30.bot > 0.3,
  'si bot llega al suelo, ha vuelto el modelo de muro');
const f1 = campo(W, H, PITCH, 0, 1000, 0);
const tabs1 = mesasCruzadas({ mx: 40, my: H / 2 }, { mx: 61, my: H / 2 }, f1, b30);
const conBanda = Z.predictLink({ x: 40, y: H / 2, ground: 0, h: 0.78 },
                               { x: 61, y: H / 2, ground: 0, h: 0.78 },
                               p, null, null, tabs1).marginDb;
const muro = tabs1.map(t => [t.x, b30.top]);          // como lo hacía la demo vieja
const conMuro = Z.predictLink({ x: 40, y: H / 2, ground: 0, h: 0.78 },
                              { x: 61, y: H / 2, ground: 0, h: 0.78 },
                              p, null, muro).marginDb;
check('la banda es MENOS pesimista que el muro con la antena por debajo ' +
      '(' + conMuro.toFixed(1) + ' -> ' + conBanda.toFixed(1) + ' dB)',
  conBanda > conMuro + 5);


// ── 9) el CABLEADO de la página, ejecutándola de verdad ─────────────────
// Los bloques de arriba prueban el MECANISMO —campo, corte, banda— llamando a
// las funciones a mano. Eso deja fuera lo único que el bug original era: qué
// slider alimenta a qué. Medido con mutante: acoplar otra vez el eje del tubo
// a la altura de antena (`tableBand(0, s.ha, ...)`) dejaba los 26 checks
// anteriores EN VERDE. Un mutante que sobrevive es un test que falta.
//
// Así que aquí se ejecuta el script ENTERO de la página con el DOM simulado y
// se mueven los mandos como los movería una persona.
(function cableado() {
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/);
  check('el script de la página se puede extraer', !!script);
  if (!script) return;

  const mandos = { tilt: 30, pitch: 7, az: 0, blk: 1000, st: 0,
                   ha: 1.5, hx: 1.5, thr: 8 };
  const salidas = {};
  const nodo = id => (id in mandos)
    ? { get value() { return String(mandos[id]); }, addEventListener() {} }
    : { set textContent(v) { salidas[id] = v; }, get textContent() { return salidas[id]; },
        addEventListener() {} };
  const lienzo = {
    width: 840, height: 440, addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 840, height: 440 }),
    getContext: () => new Proxy({}, { get: () => () => {} }),
  };
  const env = {
    console, Math, document: { getElementById: id => (id === 'plot' ? lienzo : nodo(id)) },
    window: { ZigbeePV: Z, addEventListener() {} },
    requestAnimationFrame: fn => fn(),
  };
  vm.createContext(env);
  vm.runInContext(script[1], env);
  check('la página ejecuta y publica cobertura', typeof salidas.cov === 'string',
    JSON.stringify(salidas));

  const cobertura = ha => { mandos.ha = ha; env.recompute(); return parseFloat(salidas.cov); };
  const cDebajo = cobertura(0.5), cDentro = cobertura(1.5), cEncima = cobertura(3.0);
  check('mover el slider de ANTENA cambia la cobertura ' +
        '(' + cDebajo + ' / ' + cDentro + ' / ' + cEncima + ' %)',
    cDebajo !== cDentro || cEncima !== cDentro,
    'el slider está cableado a algo que no llega al resultado');
  // El RECORRIDO es lo que discrimina, no la forma de la curva. Sobre el mapa
  // entero conviven dos efectos —librar la banda y la interferencia de dos
  // rayos, que castiga a la antena baja a larga distancia— así que 0,5 m cubre
  // MENOS que 1,5 m (40 % contra 53 %) aunque libre la placa. Medí antes de
  // afirmar: mi primera version daba por hecha una U y es la del enlace corto,
  // no la del mapa. Con el bug original el recorrido entero era plano.
  check('el recorrido del slider es GRANDE, no plano ' +
        '(' + (Math.max(cDebajo, cDentro, cEncima) - Math.min(cDebajo, cDentro, cEncima)).toFixed(0) +
        ' puntos de cobertura)',
    Math.max(cDebajo, cDentro, cEncima) - Math.min(cDebajo, cDentro, cEncima) > 25,
    'si es plano, el eje del tubo vuelve a subir con la antena');
  mandos.ha = 1.5;

  const porEje = hx => { mandos.hx = hx; env.recompute(); return parseFloat(salidas.cov); };
  const eBajo = porEje(0.8), eAlto = porEje(2.5);
  check('mover el slider del EJE cambia la cobertura (' + eBajo + ' -> ' + eAlto + ' %)',
    eBajo !== eAlto, 'el eje del tubo no llega al resultado');
  mandos.hx = 1.5;

  const porAz = az => { mandos.az = az; env.recompute(); return parseFloat(salidas.cov); };
  const a0 = porAz(0), a90 = porAz(90);
  check('mover el AZIMUT cambia la cobertura (' + a0 + ' -> ' + a90 + ' %)', a0 !== a90);
  mandos.az = 0;

  mandos.blk = 60;
  const porCalle = st => { mandos.st = st; env.recompute(); return parseFloat(salidas.cov); };
  const sinC = porCalle(0), conC = porCalle(12);
  check('abrir CALLES sube la cobertura (' + sinC + ' -> ' + conC + ' %)', conC > sinC,
    'las calles se dibujan pero no llegan a la física');
})();

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' de ' + (ok + ko)
                       : 'OK — ' + ok + '/' + ok + ' comprobaciones') + '\n');
process.exit(ko ? 1 : 0);
