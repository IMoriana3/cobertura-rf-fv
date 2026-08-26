/* =============================================================================
 * sol.js — el sol, el seguimiento y la estética de los 3D de la casa
 * =============================================================================
 * Tres cosas que todas las páginas 3D de la casa necesitan y que hasta ahora
 * cada una llevaba escritas dentro:
 *
 *   1. POSICIÓN DEL SOL — algoritmo NOAA (ecuación del tiempo + declinación),
 *      elevación y azimut para una fecha UTC y unas coordenadas.
 *   2. ÁNGULO DEL SEGUIDOR — `singleaxis` de pvlib: seguimiento astronómico
 *      sobre eje inclinado, con backtracking opcional por GCR.
 *   3. LUZ Y CIELO — la receta con la que se ven los 3D de la casa: el sol
 *      pierde fuerza y se va al rojo según baja, el cielo enciende el horizonte
 *      al alba y al ocaso y deja el cénit oscuro, y bajo el horizonte queda el
 *      rescoldo del crepúsculo.
 *
 * PROCEDENCIA. De `backtracking.html` (el simulador de backtracking, en el repo
 * de Cobertura Zigbee), que es donde vive desde antes y donde está contrastado
 * contra pvlib. Aquí no hay física nueva: hay un módulo, para que la siguiente
 * página que necesite mover un seguidor con el sol no se escriba su cuarta
 * versión de la ecuación del tiempo. Desde 0.2.0, `backtracking.html` lo LEE de
 * aquí: ya no hay dos copias.
 *
 * DOS COSAS QUE NO ERAN 1:1 y se han corregido al juntarlas (v0.2.0), las dos a
 * favor del original, que es el que está contrastado:
 *   · la REFRACCIÓN. `backtracking.html` devolvía elevación APARENTE; este
 *     módulo la daba geométrica y sin avisar. Ahora es una OPCIÓN
 *     (`solarPos(..., {refract:true})`), que es lo que pide aquel. Por defecto
 *     sigue geométrica, que es lo que usa el simulador de cobertura RF.
 *   · el CIELO. El degradado se abría con `elev/60` y en el original es
 *     `elev/35`: el cénit aclaraba más despacio de lo que aclara en los 3D de
 *     la casa. Manda el original.
 * ============================================================================= */
(function (root) {
  'use strict';
  var S = {};
  var RAD = Math.PI / 180, DEG = 180 / Math.PI;

  /* ---------------------------------------------------------------- 1. EL SOL */
  function julianDay(ms) { return ms / 86400000 + 2440587.5; }

  /* Refracción atmosférica [grados] — la que aparta el disco del horizonte. */
  S.refraction = function (elev) {
    var te = Math.tan(elev * RAD), r;
    if (elev > 85) r = 0;
    else if (elev > 5) r = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5);
    else if (elev > -0.575) r = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else r = -20.772 / te;
    return r / 3600;
  };

  /* Posición del sol (NOAA). dateUTCms en ms; lat/lon en grados (lon + al este).
     Devuelve {elev, az, zen, decl, eqTime, ha} en grados.

     REFRACCIÓN. Por defecto la elevación es GEOMÉTRICA. Con `{refract:true}` se
     devuelve la APARENTE —la que ve el ojo, con el disco ya apartado del
     horizonte— y `zen` se recalcula con ella. La diferencia es de centésimas
     salvo pegada al horizonte, donde llega a medio grado y decide si el sol ha
     salido o no; por eso lo pide `backtracking.html`, que es el que se carea
     contra pvlib. El simulador de cobertura RF usa la geométrica, que es la que
     usaba, y para mover un seguidor a efectos de cobertura da igual. */
  S.solarPos = function (dateUTCms, lat, lon, opts) {
    var jd = julianDay(dateUTCms), T = (jd - 2451545) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; if (L0 < 0) L0 += 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var Mr = M * RAD;
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    var trueLong = L0 + C, omega = 125.04 - 1934.136 * T;
    var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    var eps0 = 23 + (26 + ((21.448 - T * (46.815 + T * (0.00059 - T * 0.001813)))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) / RAD;
    var y = Math.tan(eps * RAD / 2); y *= y;
    var L0r = L0 * RAD;
    var Et = y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
             0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr);
    var eqTime = 4 * Et / RAD;
    var d = new Date(dateUTCms);
    var mins = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    var tst = (mins + eqTime + 4 * lon) % 1440; if (tst < 0) tst += 1440;
    var ha = tst / 4 - 180;
    var latr = lat * RAD, declr = decl * RAD, har = ha * RAD;
    var cosZ = Math.sin(latr) * Math.sin(declr) + Math.cos(latr) * Math.cos(declr) * Math.cos(har);
    cosZ = Math.max(-1, Math.min(1, cosZ));
    var zen = Math.acos(cosZ) / RAD, elev = 90 - zen;
    var azDen = Math.cos(latr) * Math.sin(zen * RAD), az;
    if (Math.abs(azDen) > 1e-9) {
      var azc = (Math.sin(latr) * Math.cos(zen * RAD) - Math.sin(declr)) / azDen;
      azc = Math.max(-1, Math.min(1, azc));
      az = Math.acos(azc) / RAD;
      if (ha > 0) az = (az + 180) % 360; else az = (540 - az) % 360;
    } else az = (lat > decl) ? 180 : 0;
    if (opts && opts.refract) {
      var ap = elev + S.refraction(elev);
      return { elev: ap, az: az, zen: 90 - ap, decl: decl, eqTime: eqTime, ha: ha };
    }
    return { elev: elev, az: az, zen: zen, decl: decl, eqTime: eqTime, ha: ha };
  };

  /* ------------------------------------------------- 2. EL ÁNGULO DEL SEGUIDOR */
  /* Ángulo de seguimiento verdadero (pvlib `wid`, eje inclinado, sin recorte). */
  S.trueTrackAngle = function (zenDeg, azDeg, axisTilt, axisAz) {
    var sz = Math.sin(zenDeg * RAD);
    var x = sz * Math.sin(azDeg * RAD), y = sz * Math.cos(azDeg * RAD), z = Math.cos(zenDeg * RAD);
    var ca = Math.cos(axisAz * RAD), sa = Math.sin(axisAz * RAD);
    var ct = Math.cos(axisTilt * RAD), st = Math.sin(axisTilt * RAD);
    return Math.atan2(x * ca - y * sa, x * sa * st + y * ca * st + z * ct) * DEG;
  };

  /* pvlib `singleaxis`. p = {axisTilt, axisAz, maxAngle, backtrack, gcr, crossAxisTilt}
     De noche devuelve NaN, como pvlib: el que llama decide (stow, 0, …). */
  S.singleaxis = function (zenDeg, azDeg, p) {
    if (!(zenDeg < 90)) return NaN;
    var wid = S.trueTrackAngle(zenDeg, azDeg, p.axisTilt || 0, p.axisAz || 0);
    var th = wid;
    if (p.backtrack) {
      var cross = p.crossAxisTilt || 0;
      var axesDist = 1 / (p.gcr * Math.cos(cross * RAD));
      var temp = Math.abs(axesDist * Math.cos((wid - cross) * RAD));
      // a mediodía temp >= 1: no hay sombra fila a fila que evitar, no se corrige
      if (temp < 1) th = wid - Math.sign(wid) * Math.acos(temp) * DEG;
    }
    var mx = (p.maxAngle === undefined) ? 60 : p.maxAngle;
    return Math.max(-mx, Math.min(mx, th));
  };

  /* --------------------------------------------------------- 3. LUZ Y CIELO */
  /* Cómo se ve el sol según su altura: al bajar pierde fuerza y se va al rojo.
     Devuelve {color:[r,g,b] 0..1, intensity, hemi, warm}. */
  S.sunLook = function (elevDeg) {
    var warm = Math.max(0, Math.min(1, (12 - elevDeg) / 12));
    return {
      warm: warm,
      color: [1, 0.93 - 0.38 * warm, 0.80 - 0.62 * warm],
      intensity: 1.45 - 0.25 * warm,
      hemi: 0.55 + 0.15 * warm
    };
  };

  /* Cénit y horizonte del cielo para una altura de sol. `up` = qué tan alto está
     (0 en el horizonte, 1 al cénit). Con el sol bajo, el horizonte se enciende y
     el cénit queda oscuro; por debajo de 0° solo queda el rescoldo, que se apaga
     entre 0 y −8°. Devuelve {top:[r,g,b], hor:[r,g,b], noche:bool}. */
  S.skyColors = function (elevDeg) {
    if (elevDeg > 0) {
      var up = Math.max(0, Math.min(1, elevDeg / 35));
      var warm = Math.max(0, Math.min(1, (12 - elevDeg) / 12));
      return {
        noche: false,
        top: [0.04 + 0.09 * up, 0.07 + 0.12 * up, 0.14 + 0.22 * up],
        hor: [0.20 + 0.25 * up + 0.62 * warm * (1 - 0.5 * up),
              0.28 + 0.30 * up + 0.20 * warm * (1 - 0.5 * up),
              0.42 + 0.35 * up - 0.20 * warm]
      };
    }
    var tw = Math.max(0, (elevDeg + 8) / 8);
    return {
      noche: true,
      top: [0.028, 0.038, 0.065],
      hor: [0.05 + 0.55 * tw, 0.055 + 0.19 * tw, 0.08 + 0.03 * tw]
    };
  };

  /* Pinta el degradado del cielo en un canvas 4x512 (para una esfera invertida):
     cénit arriba, resplandor concentrado en el horizonte, bruma oscura debajo. */
  S.paintSky = function (canvas, top, hor) {
    var css = function (v) { return 'rgb(' + v.map(function (x) { return Math.round(Math.max(0, Math.min(1, x)) * 255); }).join(',') + ')'; };
    var mix = function (a, b, t) { return css(a.map(function (x, i) { return x + (b[i] - x) * t; })); };
    var cx = canvas.getContext('2d');
    var gr = cx.createLinearGradient(0, 0, 0, canvas.height);
    gr.addColorStop(0, css(top));
    gr.addColorStop(0.34, mix(top, hor, 0.28));
    gr.addColorStop(0.48, css(hor));
    gr.addColorStop(0.54, mix(hor, [0.03, 0.035, 0.05], 0.55));
    gr.addColorStop(1, 'rgb(8,9,13)');
    cx.fillStyle = gr; cx.fillRect(0, 0, canvas.width, canvas.height);
    return css(top) + '|' + css(hor);          // clave: repintar solo si cambia
  };

  /* Vector unitario hacia el sol en el marco de la escena del visor RF:
     +X a través de las filas (oeste), +Z a lo largo del tubo (sur), +Y arriba.
     El eje del seguidor es N-S, así que el norte de la escena es −Z. */
  S.sunVector = function (elevDeg, azDeg) {
    var el = elevDeg * RAD, az = azDeg * RAD;
    return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
  };

  S.VERSION = '0.2.0';
  root.Sol = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : this);
