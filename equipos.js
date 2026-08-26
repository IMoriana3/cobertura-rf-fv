/* =============================================================================
 * equipos.js — NCU y HSU, los dos equipos de planta que cierran la malla Zigbee
 * =============================================================================
 * `seguidor.js` trae el seguidor. Faltaban los otros dos extremos del enlace:
 *
 *   NCU — el COORDINADOR. Armario 415×515×230 colgado por sus 4 escuadras de la
 *         cara sur de un poste C 100×60 de 2,95 m hincado, con el látigo de
 *         antena en la CABEZA del poste. Plano DR_NCU_v0 / «Montaje NCU» (3400
 *         con hinca). Su antena queda a 3,15 m: POR ENCIMA de la cresta de las
 *         mesas, que es justo lo que hace que un salto TCU→NCU cruce la banda de
 *         cada fila en vez de pasar por debajo como hace un TCU↔TCU.
 *
 *   HSU — la estación meteo. Torre de celosía triangular AUTOPORTANTE de 8 m
 *         (sin vientos), anemómetro ULTRASÓNICO en cabeza (sin cazoletas), dos
 *         látigos de antena a ~8,3 m, módulo FV estrecho y vertical paralelo a
 *         la cara, caja FACTIUN, garita y piranómetro. Plano FTR.24.00145_5_C,
 *         «Montaje HSU» (8000 con niveles 4500/1000) + fotos de campo.
 *
 * PROCEDENCIA. Las cotas no se inventan aquí: son las que dibuja `terreno.html`
 * (Cobertura 3D) desde antes, con sus planos citados. Este fichero las saca a un
 * módulo para que el simulador de cobertura RF use LAS MISMAS y no una segunda
 * versión a ojo — el mismo motivo por el que el seguidor se pide a `seguidor.js`.
 * Mientras `terreno.html` siga con su copia embebida, este módulo y aquel bloque
 * hay que tocarlos a la vez; extraerlo allí también es la tarea pendiente.
 *
 * Marco local de los dos: origen en el PIE, sobre el suelo (y = 0), +Y arriba.
 * `buildNCU`/`buildHSU` devuelven un THREE.Group listo para posicionar.
 * ============================================================================= */
(function (root) {
  'use strict';
  var E = {};

  /* ---------- COTAS (m) ---------- */
  var D = {
    /* NCU — plano DR_NCU_v0 */
    ncuMastH:   2.95,    // poste C 100×60 hincado
    ncuMastW:   0.10,    // ala del perfil C
    ncuMastD:   0.06,
    ncuCabW:    0.415,   // armario
    ncuCabH:    0.515,
    ncuCabD:    0.230,
    ncuCabY:    1.15,    // altura de servicio del centro del armario
    ncuRailDy:  0.2772,  // los 2 carriles, ± sobre el centro del armario
    ncuAntY:    3.15,    // CENTRO del látigo, en la cabeza del poste
    ncuAntL:    0.40,
    ncuAntX:    0.06,

    /* HSU — plano FTR.24.00145_5_C */
    hsuTowerH:  8.00,    // torre de celosía autoportante
    hsuLegR:    0.15,    // radio del triángulo de montantes
    hsuLevels:  16,      // cinturones/zigzag
    hsuAntY:    8.33,    // CENTRO del látigo BAJO (el par va a 8,33 y 8,36):
    hsuAntY2:   8.36,    //   se declara el bajo, que es el conservador
    hsuPvW:     0.35,    // módulo FV estrecho, vertical y paralelo a la cara
    hsuPvH:     1.70,
    hsuPvY:     2.35,
    hsuBoxY:    0.95     // caja FACTIUN
  };
  E.DIMS = D;

  /* Altura de antena de cada equipo sobre SU suelo. La del TCU no está aquí
     porque cuelga de la viga: la fija `seguidor.js` (0,225 del conector + los
     0,50 de coax) y depende de la altura del tubo. */
  E.ANT_H = { ncu: D.ncuAntY, hsu: D.hsuAntY };

  E.materials = function (THREE) {
    return {
      mast:  new THREE.MeshStandardMaterial({ color: 0xc4cad1, roughness: .50, metalness: .55 }),
      pole:  new THREE.MeshStandardMaterial({ color: 0x9aa3ac, roughness: .45, metalness: .60 }),
      enc:   new THREE.MeshStandardMaterial({ color: 0xe2e5e7, roughness: .50, metalness: .15 }),
      front: new THREE.MeshStandardMaterial({ color: 0xeceef0, roughness: .45, metalness: .10 }),
      dark:  new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: .50, metalness: .40 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: .85 }),
      black: new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: .50, metalness: .25 }),
      led:   new THREE.MeshStandardMaterial({ color: 0xd9a11c, emissive: 0x8a5f00, emissiveIntensity: .8 })
    };
  };

  function add(g, mesh, x, y, z) { mesh.position.set(x, y, z); g.add(mesh); return mesh; }

  /* Las sombras las decide la escena, no el modelo: Cobertura 3D ya da una
     pasada por su grupo de instalaciones, y allí el poste y el armario de la
     NCU eran los únicos que proyectaban. `opts.shadows` las pone en TODAS las
     piezas para quien no tenga esa pasada (el simulador de cobertura RF). */
  function sombras(g, on) {
    if (!on) return;
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  /* Corrugado granate de la fibra + alimentación subiendo por el poste (foto). */
  function corrTex(THREE) {
    var cv = document.createElement('canvas'); cv.width = 8; cv.height = 32;
    var c = cv.getContext('2d');
    c.fillStyle = '#6e3d47'; c.fillRect(0, 0, 8, 32);
    c.fillStyle = '#84505c'; for (var q = 0; q < 32; q += 8) c.fillRect(0, q, 8, 4);
    var t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 5);
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  /* =========================== NCU =========================== */
  /* El armario NO va ensartado en el poste ni la antena sale de su tapa: cuelga
     de la cara (−Z local) por 4 escuadras, y el látigo está arriba del todo. */
  E.buildNCU = function (THREE, opts) {
    opts = opts || {};
    var m = opts.materials || E.materials(THREE);
    var g = new THREE.Group();

    // poste C 100×60
    var s = new THREE.Shape();
    s.moveTo(-0.05, 0.03); s.lineTo(-0.05, -0.03); s.lineTo(0.05, -0.03); s.lineTo(0.05, 0.03);
    s.lineTo(0.038, 0.03); s.lineTo(0.038, -0.022); s.lineTo(-0.038, -0.022); s.lineTo(-0.038, 0.03);
    s.closePath();
    var pg = new THREE.ExtrudeGeometry(s, { depth: D.ncuMastH, bevelEnabled: false });
    pg.translate(0, 0, -D.ncuMastH / 2); pg.rotateX(-Math.PI / 2);
    add(g, new THREE.Mesh(pg, m.pole), 0, D.ncuMastH / 2, 0).castShadow = true;

    // 2 carriles horizontales atornillados al poste: de ellos cuelga la NCU
    [D.ncuRailDy, -D.ncuRailDy].forEach(function (dy) {
      add(g, new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.04), m.pole), 0, D.ncuCabY + dy, -0.075);
    });

    // corrugado (fibra + alimentación) y el bucle del látigo de fibra
    var corr = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.05, 8),
      new THREE.MeshStandardMaterial({ map: corrTex(THREE), roughness: .85, metalness: .05 }));
    add(g, corr, 0.09, 0.525, 0.05);
    for (var q = 0; q < 2; q++) {
      var coil = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.004, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0x101216, roughness: .6 }));
      coil.rotation.y = 0.5; add(g, coil, 0.02, 1.02 - q * 0.02, 0.10);
    }

    // armario + frontal + 4 escuadras + 2 prensaestopas + conector + LED
    var zC = -(D.ncuCabD / 2 + 0.055);
    add(g, new THREE.Mesh(new THREE.BoxGeometry(D.ncuCabW, D.ncuCabH, D.ncuCabD), m.enc), 0, D.ncuCabY, zC).castShadow = true;
    add(g, new THREE.Mesh(new THREE.BoxGeometry(D.ncuCabW * 0.94, D.ncuCabH * 0.94, 0.012), m.front),
        0, D.ncuCabY, zC - D.ncuCabD / 2 - 0.007);
    [[-0.181, 0.2805], [0.181, 0.2805], [-0.181, -0.2805], [0.181, -0.2805]].forEach(function (b) {
      add(g, new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.05), m.pole),
          b[0], D.ncuCabY + b[1], zC + D.ncuCabD / 2 + 0.026);
    });
    [-0.05, 0.05].forEach(function (gx) {
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), m.dark),
          gx, D.ncuCabY - D.ncuCabH / 2 - 0.024, zC);
    });
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.10, 6), m.dark),
        0.12, D.ncuCabY + D.ncuCabH / 2 + 0.05, zC);
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.02), m.led),
        0.05, D.ncuCabY + D.ncuCabH / 2 + 0.004, zC + 0.03);

    // LÁTIGO en la cabeza del poste — el extremo que ve la malla
    var ant = add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, D.ncuAntL, 5),
                                    opts.antMaterial || m.dark), D.ncuAntX, D.ncuAntY, 0);
    sombras(g, opts.shadows);
    return { group: g, antenna: ant, antPos: new THREE.Vector3(D.ncuAntX, D.ncuAntY, 0) };
  };

  /* =========================== HSU =========================== */
  /* Torre autoportante: 3 montantes con cinturones y zigzag alterno por cara.
     `opts.pv` = false quita el módulo FV (las HSU de Ayora no lo llevan).
     `opts.giro` gira SOLO los montantes, que es lo que orienta la cara del
     módulo: al SUR en el hemisferio norte y al NORTE en el sur (medio giro con
     latitud negativa). La cabeza, los látigos, el piranómetro y la garita se
     quedan donde están — así lo hace Cobertura 3D, y así se mantiene. */
  E.buildHSU = function (THREE, opts) {
    opts = opts || {};
    var m = opts.materials || E.materials(THREE);
    var withPV = opts.pv !== false;
    var g = new THREE.Group();
    var h = D.hsuTowerH, RT = D.hsuLegR, NL = D.hsuLevels, LEG = [];
    var giro = opts.giro || 0;

    for (var lg = 0; lg < 3; lg++) {
      var a = lg * 2 * Math.PI / 3 + Math.PI / 6 + giro;
      var lx = Math.cos(a) * RT, lz = Math.sin(a) * RT;
      LEG.push([lx, lz]);
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, h, 8), m.mast), lx, h / 2, lz);
    }
    var W = RT * 1.732;
    for (var lv = 0; lv <= NL; lv++) {
      var yy = lv * h / NL;
      for (var fa = 0; fa < 3; fa++) {
        var A = LEG[fa], B = LEG[(fa + 1) % 3];
        if (lv > 0) {
          var rung = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, W, 6), m.mast);
          rung.rotation.z = Math.PI / 2; rung.rotation.y = -Math.atan2(B[1] - A[1], B[0] - A[0]);
          add(g, rung, (A[0] + B[0]) / 2, yy, (A[1] + B[1]) / 2);
        }
        if (lv < NL) {
          var top = (lv % 2 === 0), a9 = top ? A : B, b9 = top ? B : A, dz = h / NL;
          var dgl = Math.sqrt(W * W + dz * dz);
          var dg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, dgl, 6), m.mast);
          dg.rotation.z = Math.PI / 2 - Math.atan2(dz, W);
          dg.rotation.y = -Math.atan2(b9[1] - a9[1], b9[0] - a9[0]);
          add(g, dg, (a9[0] + b9[0]) / 2, yy + dz / 2, (a9[1] + b9[1]) / 2);
        }
      }
    }

    // cara 0-1 (la del módulo) y su normal exterior
    var fx = (LEG[0][0] + LEG[1][0]) / 2, fz = (LEG[0][1] + LEG[1][1]) / 2;
    var fl = Math.hypot(fx, fz) || 1, nx = fx / fl, nz = fz / fl;

    if (withPV) {
      var pvG = new THREE.Group();
      pvG.position.set(fx + nx * 0.06, D.hsuPvY, fz + nz * 0.06);
      pvG.rotation.y = -Math.atan2(nz, nx) + Math.PI / 2;
      g.add(pvG);
      pvG.add(new THREE.Mesh(new THREE.BoxGeometry(D.hsuPvW + 0.02, D.hsuPvH + 0.02, 0.030), m.mast));
      var pvM = opts.panelMaterial ||
        new THREE.MeshStandardMaterial({ color: 0x16305e, roughness: .30, metalness: .10 });
      var lam = new THREE.Mesh(new THREE.PlaneGeometry(D.hsuPvW - 0.02, D.hsuPvH - 0.02), pvM);
      lam.position.z = 0.017; pvG.add(lam);
      [-0.75, 0.75].forEach(function (bo) {
        var br = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.04, 0.05), m.mast);
        br.position.set(0, bo, -0.045); pvG.add(br);
      });
    }

    // caja FACTIUN
    var jb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 0.12), m.white);
    jb.rotation.y = -Math.atan2(nz, nx) + Math.PI / 2;
    add(g, jb, fx + nx * 0.13, D.hsuBoxY, fz + nz * 0.13);

    // cabeza: placa + mastilillo + ANEMÓMETRO ULTRASÓNICO (sin partes móviles)
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.34), m.mast), 0, h + 0.01, 0);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.30, 6), m.mast), 0, h + 0.16, 0);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), m.white), 0, h + 0.32, 0);
    for (var pr = 0; pr < 3; pr++) {
      var pa = pr * 2 * Math.PI / 3;
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 5), m.black),
          Math.cos(pa) * 0.032, h + 0.375, Math.sin(pa) * 0.032);
    }
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.015, 10), m.white), 0, h + 0.425, 0);

    // los DOS látigos de antena
    var antM = opts.antMaterial || m.black, ants = [];
    [[0.12, 0.40], [-0.12, 0.34]].forEach(function (an) {
      ants.push(add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, an[1], 5), antM),
                    an[0], h + 0.16 + an[1] / 2, -0.12));
    });

    // brazo del piranómetro y garita
    var py = h - 1.0;
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.03), m.mast), 0.35, py, 0);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 20), m.black);
    ring.rotation.x = Math.PI / 2; add(g, ring, 0.68, py, 0);
    add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), m.black), 0.68, py, 0);
    var gy = h * 0.62;
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.03), m.mast), -0.22, gy, 0);
    for (var d2 = 0; d2 < 5; d2++) {
      add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.12 - d2 * 0.004, 0.125 - d2 * 0.004, 0.03, 14), m.white),
          -0.42, gy - 0.12 + d2 * 0.06, 0);
    }
    sombras(g, opts.shadows);
    return { group: g, antennas: ants, antPos: new THREE.Vector3(-0.12, D.hsuAntY, -0.12) };
  };

  E.VERSION = '0.1.0';
  root.Equipos = E;
})(typeof window !== 'undefined' ? window : this);
