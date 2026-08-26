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

  function reflectionCoefficient(theta, epsR, sigma, fHz, pol = "v") {
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

  const defaultParams = () => ({
    fHz: 2.45e9, ptxDbm: 19.0, gtxDbi: 3.0, grxDbi: 3.0, rxSensDbm: -103.0,
    sigmaDb: 6.0, epsR: 15.0, sigmaGround: 5e-3, pol: "v", lModDb: 0.0,
  }); // ptxDbm: XBee-PRO RR. Estándar +8. Canal 26: máx +3. Antena Jinchang 3 dBi.

  // Parámetros calibrados con El Burgo I (NCU1): el sesgo real -33.6 dB trasladado
  // a potencia efectiva + sigma del residuo 6.8 dB. Sin esto la cobertura sale
  // ~33 dB optimista (n_eff≈0.4: la distancia predice poco; manda la obstrucción
  // local). Úsalo para cualquier predicción de cobertura "tipo El Burgo".
  const EL_BURGO_BIAS_DB = -33.6;
  const defaultParamsElBurgo = () => {
    const p = defaultParams();
    p.ptxDbm += EL_BURGO_BIAS_DB;   // traslada el sesgo a potencia efectiva
    p.sigmaDb = 6.8;
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
  function predictLink(tx, rx, p, terrain, obstacles) {
    p = p || defaultParams();
    const d = Math.hypot(rx.x - tx.x, rx.y - tx.y);
    const pl2 = twoRayPlDb(d, tx.h, rx.h, p.fHz, p.epsR, p.sigmaGround, p.pol);
    let plDiff = 0.0;
    const pts = (terrain || []).concat(obstacles || []);
    if (pts.length) {
      plDiff = diffractionLossDb(d, tx.ground + tx.h, rx.ground + rx.h, pts, p.fHz);
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
    defaultParams, defaultParamsElBurgo,
  };
  global.ZigbeePV = ZigbeePV;
  if (typeof module !== "undefined" && module.exports) module.exports = ZigbeePV;
})(typeof window !== "undefined" ? window : globalThis);
