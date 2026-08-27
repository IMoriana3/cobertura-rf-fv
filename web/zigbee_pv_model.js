/*
 * zigbee_pv_model.js
 * ==================
 * Port al navegador del núcleo de propagación Zigbee 2.4 GHz.
 * Paridad con zigbee_pv_model.py: FSPL + dos rayos (coef. de Fresnel) +
 * difracción multiobstáculo (Deygout) + balance de enlace.
 *
 * Sin dependencias. Uso en demo-siting.html:
 *   const r = ZigbeePV.predictLink(tx, rx, ZigbeePV.defaultParams());
 *   // r.marginDb, r.prxDbm, r.pLink
 */
(function (global) {
  "use strict";
  const C = 299792458.0;

  // --- aritmética compleja mínima (para el coef. de reflexión) ---
  const cx = (re, im) => ({ re, im: im || 0 });
  const cAdd = (a, b) => cx(a.re + b.re, a.im + b.im);
  const cSub = (a, b) => cx(a.re - b.re, a.im - b.im);
  const cMul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const cScale = (a, s) => cx(a.re * s, a.im * s);
  const cAbs = (a) => Math.hypot(a.re, a.im);
  function cDiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cSqrt(z) {
    const r = Math.hypot(z.re, z.im);
    const re = Math.sqrt((r + z.re) / 2);
    let im = Math.sqrt((r - z.re) / 2);
    if (z.im < 0) im = -im;
    return cx(re, im);
  }
  function cExp(z) {
    const e = Math.exp(z.re);
    return cx(e * Math.cos(z.im), e * Math.sin(z.im));
  }

  const wavelength = (fHz = 2.45e9) => C / fHz;
  const fsplDb = (dM, fHz = 2.45e9) =>
    20 * Math.log10(Math.max(dM, 1e-3)) + 20 * Math.log10(fHz) - 147.55;
  const breakpointDistance = (ht, hr, fHz = 2.45e9) => (4 * ht * hr) / wavelength(fHz);
  const fresnelRadius = (d1, d2, fHz = 2.45e9, n = 1) =>
    Math.sqrt((n * wavelength(fHz) * d1 * d2) / (d1 + d2));

  /* epsR = Infinity -> CONDUCTOR PERFECTO: Gamma = +1, sin dependencia del
     ángulo. Es el caso de referencia (cota superior del rebote) que ofrece el
     visor junto a la tierra real; tenerlo aquí evita que cada página se escriba
     su propio "dos rayos con suelo perfecto". */
  function reflectionCoefficient(theta, epsR, sigma, fHz, pol = "v") {
    if (!isFinite(epsR)) return cx(1, 0);
    const lam = wavelength(fHz);
    const eps = cx(epsR, -60.0 * lam * sigma);
    const s = Math.sin(theta);
    const cos2 = Math.cos(theta) ** 2;
    const root = cSqrt(cSub(eps, cx(cos2, 0)));
    if (pol.toLowerCase().startsWith("v")) {
      const es = cScale(eps, s);
      return cDiv(cSub(es, root), cAdd(es, root));
    }
    return cDiv(cSub(cx(s, 0), root), cAdd(cx(s, 0), root));
  }

  function twoRayPlDb(dM, ht, hr, fHz = 2.45e9, epsR = 15.0, sigma = 5e-3, pol = "v") {
    dM = Math.max(dM, 1e-3);
    const lam = wavelength(fHz);
    const dLos = Math.hypot(dM, ht - hr);
    const dRef = Math.hypot(dM, ht + hr);
    const theta = Math.atan2(ht + hr, dM);
    const gamma = reflectionCoefficient(theta, epsR, sigma, fHz, pol);
    const dphi = (2 * Math.PI * (dRef - dLos)) / lam;
    const refl = cScale(cMul(gamma, cExp(cx(0, -dphi))), 1 / dRef);
    const field = cAdd(cx(1 / dLos, 0), refl);
    return -20 * Math.log10((lam / (4 * Math.PI)) * cAbs(field));
  }

  function knifeEdgeLossDb(v) {
    if (v <= -0.78) return 0.0;
    return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
  }

  function vParam(hClear, d1, d2, fHz) {
    return hClear * Math.sqrt((2 * (d1 + d2)) / (wavelength(fHz) * d1 * d2));
  }

  // Deygout sobre obstacles = [[xHorizontal, cotaSuperior], ...]
  function diffractionLossDb(D, txElev, rxElev, obstacles, fHz = 2.45e9, depth = 0, maxDepth = 3) {
    if (!obstacles || !obstacles.length || depth >= maxDepth || D <= 0) return 0.0;
    let bestV = -1e9, bestI = -1;
    for (let i = 0; i < obstacles.length; i++) {
      const [x, top] = obstacles[i];
      if (x <= 0 || x >= D) continue;
      const los = txElev + (rxElev - txElev) * (x / D);
      const v = vParam(top - los, x, D - x, fHz);
      if (v > bestV) { bestV = v; bestI = i; }
    }
    if (bestI < 0 || bestV <= -0.78) return 0.0;
    const [x0, top0] = obstacles[bestI];
    let loss = knifeEdgeLossDb(bestV);
    const left = obstacles.filter(([x]) => x < x0);
    const right = obstacles.filter(([x]) => x > x0).map(([x, t]) => [x - x0, t]);
    loss += diffractionLossDb(x0, txElev, top0, left, fHz, depth + 1, maxDepth);
    loss += diffractionLossDb(D - x0, top0, rxElev, right, fHz, depth + 1, maxDepth);
    return loss;
  }

  // Borde superior del módulo: sube (chord/2)*sin(tilt) sobre el eje
  const rowTopElev = (ground, axisHeight, panelChord, tiltDeg) =>
    ground + axisHeight + (panelChord / 2) * Math.sin((Math.abs(tiltDeg) * Math.PI) / 180);

  /* ------------------------------------------------------------------
   * LA MESA COMO OBSTÁCULO
   * Una fila de seguidores NO es un muro desde el suelo: es una PLACA
   * inclinada que ocupa una banda de altura [bot, top] sobre una huella de
   * ±hw alrededor del eje de la fila. Al inclinarse, su borde bajo BAJA y su
   * cresta SUBE, así que un rayo rasante puede pasar por DEBAJO limpio — que
   * es exactamente lo que hace el salto TCU↔TCU con la antena colgada a la
   * cota de catálogo, y lo que NO hace el salto TCU→NCU, que sube a la cabeza
   * de un poste de 2,95 m y cruza la banda de todas las filas de en medio.
   *
   * La regla de despeje es la de `terreno.html` (Cobertura 3D, `linkClearance`),
   * contrastada contra la malla MEDIDA de El Burgo: tratar el campo como un
   * muro omnidireccional dejaba el 95 % de la planta aislada, contra los 52
   * enlaces vivos que hay. El encadenado entre filas es el Deygout de siempre
   * (ITU-R P.526), el mismo de `diffractionLossDb`. Con UNA sola mesa a mitad
   * de vano reproduce el cálculo de una fila intermedia.
   * ------------------------------------------------------------------ */

  /* Banda que ocupa la mesa a una inclinación dada.
     axisH = altura del eje del tubo; off = cara del módulo sobre ese eje;
     chord = altura del módulo. Devuelve cotas SOBRE EL SUELO de la fila. */
  function tableBand(ground, axisH, chord, tiltDeg, off) {
    const a = (Math.abs(tiltDeg) * Math.PI) / 180;
    const c = ground + axisH + (off || 0) * Math.cos(a);
    const h = (chord / 2) * Math.sin(a);
    return { bot: c - h, top: c + h, hw: (chord / 2) * Math.cos(a), ground };
  }

  /* Despeje del rayo frente a una placa: + libre, − tapado. Por debajo del
     borde bajo lo que limita es el suelo O la propia placa, lo que esté más
     cerca. */
  function bandClearance(los, band) {
    if (los >= band.top) return los - band.top;
    if (los <= band.bot) return Math.min(los - band.ground, band.bot - los);
    return -Math.min(los - band.bot, band.top - los);
  }

  /* Borde por el que difracta: el que roza el rayo. */
  function bandEdge(los, band) {
    if (los >= band.top) return band.top;
    if (los <= band.bot) return band.bot;
    return los - band.bot < band.top - los ? band.bot : band.top;
  }

  /* Deygout sobre mesas = [{x, bot, top, ground}], x = distancia horizontal
     desde el Tx a lo largo del enlace. */
  function diffractionLossTablesDb(D, txElev, rxElev, tables, fHz = 2.45e9, depth = 0, maxDepth = 3) {
    if (!tables || !tables.length || depth >= maxDepth || D <= 0) return 0.0;
    let bestV = -1e9, bestI = -1;
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      if (t.x <= 0 || t.x >= D) continue;
      const los = txElev + (rxElev - txElev) * (t.x / D);
      const v = vParam(-bandClearance(los, t), t.x, D - t.x, fHz);
      if (v > bestV) { bestV = v; bestI = i; }
    }
    if (bestI < 0 || bestV <= -0.78) return 0.0;
    const t0 = tables[bestI];
    const los0 = txElev + (rxElev - txElev) * (t0.x / D);
    const edge = bandEdge(los0, t0);
    let loss = knifeEdgeLossDb(bestV);
    const left = tables.filter((t) => t.x < t0.x);
    const right = tables.filter((t) => t.x > t0.x).map((t) => Object.assign({}, t, { x: t.x - t0.x }));
    loss += diffractionLossTablesDb(t0.x, txElev, edge, left, fHz, depth + 1, maxDepth);
    loss += diffractionLossTablesDb(D - t0.x, edge, rxElev, right, fHz, depth + 1, maxDepth);
    return loss;
  }

  /* ------------------------------------------------------------------
   * COTAS DE ANTENA DE CATÁLOGO (m). Fuente única para que el visor, el
   * diagnóstico y el siting hablen de los mismos equipos.
   *   TCU — cuelga de la viga, así que su cota depende de la altura del tubo:
   *         se da la CAÍDA bajo el eje (0,225 hasta el conector de la TCU +
   *         los 0,50 de coax de `seguidor.js`).
   *   NCU — látigo en la CABEZA del poste C 100×60 de 2,95 m del que cuelga el
   *         armario 415×515×230 (plano DR_NCU_v0 / «Montaje NCU»).
   *   HSU — 2 látigos en su BRAZO a media torre (6,50 m) de la celosía
   *         autoportante de 8 m (plano FTR.24.00145_5_C, «Montaje HSU»).
   * Las tres, tal como las dibuja `terreno.html` en Cobertura 3D.
   * ------------------------------------------------------------------ */
  const ANTENNAS = {
    tcu: { dropBelowTube: 0.725 },
    ncu: { mastH: 2.95, h: 3.15, cabW: 0.415, cabH: 0.515, cabD: 0.230, cabY: 1.15 },
    hsu: { towerH: 8.0, h: 6.50, legR: 0.15 },   // los látigos van en su brazo a media torre, no en la cabeza
  };

  const defaultParams = () => ({
    fHz: 2.45e9, ptxDbm: 19.0, gtxDbi: 3.0, grxDbi: 3.0, rxSensDbm: -103.0,
    sigmaDb: 6.0, epsR: 15.0, sigmaGround: 5e-3, pol: "v", lModDb: 0.0,
  }); // ptxDbm: XBee-PRO RR. Estándar +8. Canal 26: máx +3. Antena Jinchang 3 dBi.

  /* Recentrado con El Burgo I (NCU1) — espejo de `EL_BURGO_BIAS_DB` en el puerto
     Python, donde está la explicación larga. En corto, y hay que leerlo antes de
     usarlo: el -33,6 con sigma 6,8 que había aquí NO se reproduce con los datos
     del repo; el ajuste real da -16,58 con sigma 10,99 (`python/calibra_elburgo.py`).
     Y ni ese es una calibración de propagación: sobre 49 enlaces de 24 a 338 m el
     RSSI medido correlaciona r = +0,16 con log(distancia), o sea que NO depende de
     la distancia — muestra censurada, la malla enruta por lo que funciona. Sirve
     para recentrar sobre el nivel típico de un enlace que la malla USA, no para el
     nivel absoluto ni para saber dónde deja de haber enlace. */
  const EL_BURGO_BIAS_DB = -16.58;
  const EL_BURGO_SIGMA_DB = 10.99;
  const defaultParamsElBurgo = () => {
    const p = defaultParams();
    p.ptxDbm += EL_BURGO_BIAS_DB;   // traslada el sesgo a potencia efectiva
    p.sigmaDb = EL_BURGO_SIGMA_DB;
    p.biasDb = EL_BURGO_BIAS_DB;
    return p;
  };

  const _phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  function erf(x) { // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }

  // tx/rx = {x, y, ground, h};  obstacles/terrain = [[x, cota], ...]
  // tables = [{x, bot, top, ground}] -> mesas (placas), ver diffractionLossTablesDb
  function predictLink(tx, rx, p, terrain, obstacles, tables) {
    p = p || defaultParams();
    const d = Math.hypot(rx.x - tx.x, rx.y - tx.y);
    const pl2 = twoRayPlDb(d, tx.h, rx.h, p.fHz, p.epsR, p.sigmaGround, p.pol);
    let plDiff = 0.0;
    const pts = (terrain || []).concat(obstacles || []);
    if (pts.length) {
      plDiff = diffractionLossDb(d, tx.ground + tx.h, rx.ground + rx.h, pts, p.fHz);
    }
    if (tables && tables.length) {
      plDiff += diffractionLossTablesDb(d, tx.ground + tx.h, rx.ground + rx.h, tables, p.fHz);
    }
    const plTotal = pl2 + plDiff + p.lModDb;
    const prx = p.ptxDbm + p.gtxDbi + p.grxDbi - plTotal;
    const margin = prx - p.rxSensDbm;
    return {
      distanceM: +d.toFixed(2), prxDbm: +prx.toFixed(2), marginDb: +margin.toFixed(2),
      pLink: +_phi(margin / p.sigmaDb).toFixed(4),
      pl2rayDb: +pl2.toFixed(2), plDiffDb: +plDiff.toFixed(2),
    };
  }

  const ZigbeePV = {
    wavelength, fsplDb, breakpointDistance, fresnelRadius, reflectionCoefficient,
    twoRayPlDb, knifeEdgeLossDb, diffractionLossDb, rowTopElev, predictLink,
    defaultParams, defaultParamsElBurgo, EL_BURGO_BIAS_DB, EL_BURGO_SIGMA_DB,
    tableBand, bandClearance, bandEdge, diffractionLossTablesDb, ANTENNAS,
  };
  global.ZigbeePV = ZigbeePV;
  if (typeof module !== "undefined" && module.exports) module.exports = ZigbeePV;
})(typeof window !== "undefined" ? window : globalThis);
