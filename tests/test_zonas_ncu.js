/* ¿QUÉ CUELGA DE CADA NCU? LA ZONA TIENE QUE DECIRLO BIEN.
 *
 *   node tests/test_zonas_ncu.js [planta]
 *   ZONAS_PUNTO=si node tests/test_zonas_ncu.js   (mutación: TIENE que salir rojo)
 *
 * QUÉ SE VIGILA, Y POR QUÉ NO ES «SE DIBUJA ALGO». Un banco que mirase que hay
 * una línea pasaría con una zona que dejara equipos fuera, que es justo el
 * defecto que haría inútil el dibujo. Así que se comprueba la PROPIEDAD que
 * define una envolvente: todos los equipos de la NCU caen DENTRO de su
 * polígono, esquinas de mesa incluidas. Si eso se cumple para todas, la zona
 * dice la verdad aunque cambie la planta.
 *
 * Y una que no es obvia: la zona tiene que contener las HSU de su ámbito. Una
 * HSU puede caer lejos del campo de su NCU —está donde la puso el plano—, así
 * que es el caso donde más fácil es que el polígono se quede corto.
 *
 * LA MUTACIÓN es la que cuenta la historia: `ZONAS_PUNTO=si` construye la
 * envolvente con el PUNTO de cada seguidor en vez de con sus cuatro esquinas,
 * que es el tropiezo que `siting` ya documenta («el polígono cortaba los
 * trackers por la mitad»). El banco tiene que cazarlo.
 *
 * SIN NAVEGADOR: la geometría de la zona es aritmética sobre el layout, así que
 * esto corre en el job de núcleo y tarda milisegundos.                        */
const fs = require('fs'), path = require('path');
let ok = 0, ko = 0;
const check = (n, c, extra) => { if (c) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const RAIZ = path.dirname(__dirname);
const PLANTAS = process.argv[2] ? [process.argv[2]]
  : ['tunez', 'elburgo', 'paramo', 'polvorin', 'ayora', 'sanjose'];
const MUT = process.env.ZONAS_PUNTO === 'si';

/* Las mismas dos funciones que la página, portadas aquí. Si divergen, el banco
   deja de hablar del código que corre: por eso la de la envolvente se compara
   abajo contra una propiedad (todo dentro), no contra vértices concretos. */
function envolvente(P) {
  if (P.length < 3) return P.slice();
  const p = P.slice().sort((a, b) => a.x - b.x || a.n - b.n);
  const cruz = (o, a, b) => (a.x - o.x) * (b.n - o.n) - (a.n - o.n) * (b.x - o.x);
  const mitad = pts => { const h = []; for (const q of pts) {
      while (h.length >= 2 && cruz(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } return h; };
  const lo = mitad(p), hi = mitad(p.slice().reverse());
  lo.pop(); hi.pop(); return lo.concat(hi);
}
function esquinasFila(t, L, W) {
  const rot = (t.rot || 0) * Math.PI / 180, hl = L / 2, hw = W / 2;
  const ux = Math.sin(rot), un = Math.cos(rot), vx = Math.cos(rot), vn = -Math.sin(rot);
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]]
    .map(q => ({ x: t.x + q[0] * vx + q[1] * ux, n: t.n + q[0] * vn + q[1] * un }));
}
/* ¿Está el punto dentro del polígono convexo? Con una tolerancia de 1 mm: los
   vértices de la envolvente SON puntos del conjunto y caen justo en el borde. */
const dentro = (H, q) => {
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length];
    if ((b.x - a.x) * (q.n - a.n) - (b.n - a.n) * (q.x - a.x) < -1e-3) return false; }
  return true;
};

let totalNcu = 0, totalHsu = 0;
for (const nom of PLANTAS) {
  const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plantas', nom + '_layout.json'), 'utf8'));
  const mods = j.mods || (nom === 'sanjose' ? 32 : 28);
  const L = 2 * (mods * 1.134 + (mods - 1) * 0.012) + 0.55, W = 2.382;   // fila y cuerda canónicas
  const fz = (j.filaZ || 0) / 2;
  const por = {};
  const mete = (k, q) => { if (k == null) return; (por[k] || (por[k] = [])).push(q); };
  (j.trackers || []).forEach(t => {
    const rot = (t.rot || 0) * Math.PI / 180;
    const vigas = fz ? [{ x: t.x - fz * Math.cos(rot), n: t.n + fz * Math.sin(rot) },
                        { x: t.x + fz * Math.cos(rot), n: t.n - fz * Math.sin(rot) }]
                     : [{ x: t.x, n: t.n }];
    vigas.forEach(v => {
      const f = { x: v.x, n: v.n, rot: t.rot || 0 };
      /* MUTACIÓN: el PUNTO de la fila en vez de sus cuatro esquinas. */
      (MUT ? [{ x: f.x, n: f.n }] : esquinasFila(f, L * (t.mr || 1), W)).forEach(q => mete(t.ncu, q));
    });
  });
  const hsus = (j.meteo || []).concat(j.reps || []).filter(c => c.ncu != null);
  hsus.forEach(c => mete(c.ncu, { x: c.x, n: c.n }));

  const ambitos = Object.keys(por);
  check(`${nom}: cada NCU tiene su zona (${ambitos.length})`,
        ambitos.length > 0 && ambitos.length === new Set((j.trackers || []).map(t => t.ncu)).size,
        `${ambitos.length} zonas · ${new Set((j.trackers || []).map(t => t.ncu)).size} ámbitos`);

  /* LA PROPIEDAD, Y CONTRA QUÉ SE MIDE. La primera versión de esto preguntaba
     si la envolvente contiene los puntos con los que se construyó — que es
     verdad SIEMPRE, se haga como se haga: una tautología con aspecto de
     comprobación. La cazó su propia mutación al salir verde, que es para lo
     que está.
     Ahora se mide contra algo que NO depende de la regla: el suelo que ocupan
     de verdad los seguidores de esa NCU (sus cuatro esquinas) y la posición de
     sus HSU. La zona tiene que contenerlo. Con la regla buena se cumple; con
     el PUNTO por seguidor, las esquinas se salen y esto se pone rojo. */
  let fuera = 0, fueraHsu = 0, peor = null;
  ambitos.forEach(k => {
    const H = envolvente(por[k]); if (H.length < 3) return;
    (j.trackers || []).filter(t => String(t.ncu) === String(k)).forEach(t => {
      const rot = (t.rot || 0) * Math.PI / 180;
      const vigas = fz ? [{ x: t.x - fz * Math.cos(rot), n: t.n + fz * Math.sin(rot) },
                          { x: t.x + fz * Math.cos(rot), n: t.n - fz * Math.sin(rot) }]
                       : [{ x: t.x, n: t.n }];
      vigas.forEach(v => esquinasFila({ x: v.x, n: v.n, rot: t.rot || 0 }, L * (t.mr || 1), W)
        .forEach(q => { if (!dentro(H, q)) { fuera++; if (!peor) peor = { ncu: k, esquina: [+q.x.toFixed(1), +q.n.toFixed(1)] }; } }));
    });
    hsus.filter(c => String(c.ncu) === String(k)).forEach(c => {
      if (!dentro(H, { x: c.x, n: c.n })) { fueraHsu++; if (!peor) peor = { ncu: k, hsu: c.name }; }
    });
  });
  check(`${nom}: la zona contiene TODO el suelo de sus seguidores y sus HSU`,
        fuera === 0 && fueraHsu === 0,
        `${fuera} esquinas de mesa y ${fueraHsu} HSU fuera · ej. ${JSON.stringify(peor)}`);
  totalNcu += ambitos.length; totalHsu += hsus.length;
}
console.log(`\n${totalNcu} zonas y ${totalHsu} equipos de ámbito en ${PLANTAS.length} plantas`);

if (MUT) { console.log(ko ? `MUTACIÓN OK: el banco la caza (${ko} rojo)` : 'MUTACIÓN NO CAZADA: el banco no vale');
           process.exit(ko ? 0 : 1); }
if (ko) { console.log(`${ko} FALLOS (${ok} OK)`); process.exit(1); }
console.log(`TODAS OK (${ok} comprobaciones)`);
