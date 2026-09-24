/* ¿QUÉ CUELGA DE CADA NCU? LA ZONA TIENE QUE DECIRLO BIEN — Y SOLO ESO.
 *
 *   node tests/test_zonas_ncu.js [planta]
 *   ZONAS_PUNTO=si      node tests/test_zonas_ncu.js   (mutación: TIENE que salir rojo)
 *   ZONAS_SIN_PARTIR=si node tests/test_zonas_ncu.js   (mutación: TIENE que salir rojo)
 *
 * SON DOS MITADES Y YO SOLO ESCRIBI UNA. La primera version comprobaba que la
 * zona CONTIENE a los suyos. Eso es la mitad facil —se cumple por construccion,
 * porque la envolvente se construye con ellos— y deja pasar el defecto que de
 * verdad importa: que la zona contenga a los AJENOS. Una envolvente convexa no
 * es una particion: si los seguidores de una NCU rodean a los de otra, cosa
 * normal cuando el reparto sigue el cableado y no la geometria, la primera se
 * come a la segunda y el dibujo AFIRMA algo falso. Se vio mirando la pantalla,
 * que es exactamente como no se deben encontrar los defectos.
 *
 * Lo que habia, contando centros ajenos dentro de cada envolvente:
 *
 *       San Jose    79 de 2.289 (3,5 %)   7 zonas de 21 sucias
 *       Polvorin     7 de   119 (5,9 %)   1 de 2
 *       Paramo       6 de   396 (1,5 %)   2 de 4
 *
 * LAS HSU YA NO ESTIRAN EL POLIGONO, y por eso su comprobacion cambia. Antes la
 * zona se alargaba hasta la HSU aunque cayera lejos —«es un dato, no un defecto
 * del dibujo», escribi— y ESA era una de las causas de que cruzara campos
 * ajenos. Ahora la pertenencia se enseña con un cabo del equipo a su zona, que
 * dice lo mismo sin afirmar que el suelo de en medio es suyo. Lo comprobable
 * aqui es que cada equipo con ambito TENGA zona a la que amarrarse.
 *
 * LAS DOS MUTACIONES, una por mitad:
 *   ZONAS_PUNTO       la envolvente con el PUNTO de cada seguidor en vez de sus
 *                     cuatro esquinas (el tropiezo que `siting` ya documenta:
 *                     «el poligono cortaba los trackers por la mitad»).
 *   ZONAS_SIN_PARTIR  una sola envolvente por NCU, sin partir: el codigo de
 *                     antes. Tiene que caer por la mitad nueva.
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
const MUT_PUNTO = process.env.ZONAS_PUNTO === 'si';
const MUT_ENTERA = process.env.ZONAS_SIN_PARTIR === 'si';
const MUT = MUT_PUNTO || MUT_ENTERA;

/* Las mismas funciones que la página, portadas aquí. Si divergen, el banco deja
   de hablar del código que corre: por eso todo se mide contra PROPIEDADES (qué
   cae dentro y qué no), nunca contra vértices concretos. */
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
/* Para los AJENOS se pregunta por el centro y con la tolerancia al REVES: solo
   cuenta como tragado si esta dentro de verdad, no rozando el borde. Dos NCU
   contiguas comparten frontera y un centro justo encima no es un error. */
const dentroEstricto = (H, q) => {
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length];
    if ((b.x - a.x) * (q.n - a.n) - (b.n - a.n) * (q.x - a.x) < 1e-3) return false; }
  return true;
};

let totalNcu = 0, totalHsu = 0, totalPol = 0;
for (const nom of PLANTAS) {
  const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plantas', nom + '_layout.json'), 'utf8'));
  const mods = j.mods || (nom === 'sanjose' ? 32 : 28);
  const L = 2 * (mods * 1.134 + (mods - 1) * 0.012) + 0.55, W = 2.382;   // fila y cuerda canónicas
  const fz = (j.filaZ || 0) / 2;
  const TRK = (j.trackers || []).filter(t => t.ncu != null);

  /* Las dos vigas de una bifila, que es el suelo que ocupa de verdad. */
  const vigasDe = t => { const rot = (t.rot || 0) * Math.PI / 180;
    return fz ? [{ x: t.x - fz * Math.cos(rot), n: t.n + fz * Math.sin(rot), rot: t.rot || 0 },
                 { x: t.x + fz * Math.cos(rot), n: t.n - fz * Math.sin(rot), rot: t.rot || 0 }]
              : [{ x: t.x, n: t.n, rot: t.rot || 0 }]; };
  const puntosDe = t => { const out = [];
    vigasDe(t).forEach(v => {
      /* MUTACIÓN: el PUNTO de la fila en vez de sus cuatro esquinas. */
      (MUT_PUNTO ? [{ x: v.x, n: v.n }] : esquinasFila(v, L * (t.mr || 1), W)).forEach(q => out.push(q));
    });
    return out; };

  /* PARTIR HASTA QUE NO TRAGUE. Termina siempre: el caso base es un seguidor
     solo, cuya envolvente es su huella y no contiene el centro de ningun otro. */
  function zonasDeNCU(grupo, ajenos) {
    const pila = [grupo], out = [];
    let guarda = 0;
    while (pila.length) {
      if (++guarda > 50000) break;
      const g = pila.pop(), pts = [];
      g.forEach(t => puntosDe(t).forEach(q => pts.push(q)));
      const H = envolvente(pts);
      if (H.length < 3) { out.push({ H, g }); continue; }
      /* MUTACIÓN: no partir nunca, una envolvente por NCU (el código de antes). */
      if (MUT_ENTERA || g.length === 1 || !ajenos.some(t => dentroEstricto(H, t))) { out.push({ H, g }); continue; }
      const xs = g.map(t => t.x), ns = g.map(t => t.n);
      const eje = (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...ns) - Math.min(...ns)) ? 'x' : 'n';
      const ord = g.slice().sort((a, b) => a[eje] - b[eje]), mit = Math.floor(ord.length / 2);
      pila.push(ord.slice(0, mit), ord.slice(mit));
    }
    return out.filter(z => z.H.length >= 3);
  }

  const porT = {};
  TRK.forEach(t => { (porT[t.ncu] || (porT[t.ncu] = [])).push(t); });
  const ambitos = Object.keys(porT);
  const hsus = (j.meteo || []).concat(j.reps || []).filter(c => c.ncu != null);

  check(`${nom}: cada NCU tiene su zona (${ambitos.length})`,
        ambitos.length > 0 && ambitos.length === new Set(TRK.map(t => t.ncu)).size,
        `${ambitos.length} zonas · ${new Set(TRK.map(t => t.ncu)).size} ámbitos`);

  const zonas = {};
  ambitos.forEach(k => { zonas[k] = zonasDeNCU(porT[k], TRK.filter(t => String(t.ncu) !== String(k))); });
  const nPol = ambitos.reduce((a, k) => a + zonas[k].length, 0);

  /* MITAD 1 — CONTIENE A LOS SUYOS. Se mide contra algo que NO depende de la
     regla: el suelo que ocupan de verdad los seguidores (sus cuatro esquinas).
     Con la regla buena se cumple; con el PUNTO por seguidor, las esquinas se
     salen y esto se pone rojo. Cada seguidor contra el poligono de SU trozo. */
  let fuera = 0, peor = null;
  ambitos.forEach(k => zonas[k].forEach(z => {
    z.g.forEach(t => vigasDe(t).forEach(v =>
      esquinasFila(v, L * (t.mr || 1), W).forEach(q => {
        if (!dentro(z.H, q)) { fuera++; if (!peor) peor = { ncu: k, esquina: [+q.x.toFixed(1), +q.n.toFixed(1)] }; }
      })));
  }));
  check(`${nom}: cada zona contiene TODO el suelo de los seguidores que agrupa`,
        fuera === 0, `${fuera} esquinas de mesa fuera · ej. ${JSON.stringify(peor)}`);

  /* MITAD 2 — LA QUE FALTABA: NO CONTIENE A LOS AJENOS. Sin esto, una zona que
     se traga el campo de la NCU de al lado sale verde, que es lo que pasaba. */
  let tragados = 0, sucias = 0, ejemplo = null;
  ambitos.forEach(k => {
    const ajenos = TRK.filter(t => String(t.ncu) !== String(k));
    zonas[k].forEach(z => {
      const met = ajenos.filter(t => dentroEstricto(z.H, t));
      if (met.length) { sucias++; tragados += met.length;
        if (!ejemplo) ejemplo = { zona: 'NCU ' + k, tragados: met.length, uno: met[0].id || null, suNcu: met[0].ncu }; }
    });
  });
  check(`${nom}: ninguna zona se traga seguidores de OTRA NCU`,
        tragados === 0, `${tragados} ajenos dentro en ${sucias} zonas · ej. ${JSON.stringify(ejemplo)}`);

  /* MITAD 3 — LOS EQUIPOS. Ya no estiran el poligono, asi que lo comprobable es
     que cada uno tenga zona de su NCU a la que amarrar el cabo. */
  let huerfanos = 0, sinAmbito = null;
  hsus.forEach(c => {
    if (!zonas[c.ncu] || !zonas[c.ncu].length) { huerfanos++; if (!sinAmbito) sinAmbito = { equipo: c.name, ncu: c.ncu }; }
  });
  check(`${nom}: cada HSU/repetidor con ámbito tiene zona a la que amarrarse (${hsus.length})`,
        huerfanos === 0, `${huerfanos} sin zona · ej. ${JSON.stringify(sinAmbito)}`);

  console.log(`     ${ambitos.length} NCU -> ${nPol} polígonos`);
  totalNcu += ambitos.length; totalHsu += hsus.length; totalPol += nPol;
}
console.log(`\n${totalNcu} zonas (${totalPol} polígonos) y ${totalHsu} equipos de ámbito en ${PLANTAS.length} plantas`);

if (MUT) { console.log(ko ? `MUTACIÓN OK: el banco la caza (${ko} rojo)` : 'MUTACIÓN NO CAZADA: el banco no vale');
           process.exit(ko ? 0 : 1); }
if (ko) { console.log(`${ko} FALLOS (${ok} OK)`); process.exit(1); }
console.log(`TODAS OK (${ok} comprobaciones)`);
