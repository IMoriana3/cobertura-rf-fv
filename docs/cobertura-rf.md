# Cobertura RF — Zigbee 2.4 GHz (seguidores)

Modelo físico y visor de los enlaces Zigbee (Digi XBee RR) entre TCU y NCU en
planta. Predice cobertura, diagnostica la malla real (predicho vs. RSSI medido)
y localiza el punto único de fallo.

## Qué hace

- Render 3D interactivo (WebGL) del patrón de la antena sobre el suelo y del
  enlace bifila, coloreado por margen real en dB, con el **modelo real del
  seguidor** (`seguidor.js`, la fuente única que comparten el gemelo digital y
  Cobertura 3D): viga de torsión, correas, módulos, slew drive, TCU, seccionador,
  pilas, amortiguadores y el eje de transmisión de la bifila — y con los otros
  dos extremos de la malla: la **NCU** en su poste de 2,95 m (látigo a 3,15 m) y
  la **HSU** en su torre de 8 m (látigos en su brazo, a 6,50 m), cotas vía
  `equipos.js`. Dibuja los saltos TCU↔TCU, los tres TCU→NCU y el HSU→NCU, cada
  uno con su margen y su desglose. Geometría parametrizable (inclinación, caída
  de antena, paso de filas, altura de viga, altura de módulo, tramo dibujado,
  distancia y altura de la NCU, distancia de la HSU, suelo, radio).
- **El día**: los seguidores se mueven con el sol (NOAA + `singleaxis` de pvlib
  con backtracking, stow nocturno a 5° al este) con la estética de los 3D de la
  casa, y el margen de cada salto se recalcula a cada hora. El ángulo de las
  palas mueve el salto directo al coordinador de 5 dB al alba a 56 dB a
  mediodía: el peor rato no es la noche, es el sol rasante. El salto entre
  vecinos aguanta todo el día porque pasa por debajo de las mesas.
- La **mesa como obstáculo**: una fila no es un muro desde el suelo, es una placa
  entre dos cotas. Con la antena de la TCU por debajo del canto bajo, el salto
  entre vecinos pasa POR DEBAJO de las filas; con la de la NCU por encima de la
  cresta, el salto al coordinador las CRUZA. Esa es la diferencia entre 1,4 y
  44 dB de difracción, y ahora vive en el núcleo (regla de `terreno.html`,
  encadenada con el Deygout de siempre).
- El dibujo y la física comparten cotas: la cara del módulo sale de `DIMS.off` y
  la antena cuelga los 0,725 m del catálogo (conector de la TCU + coax), no una
  cota inventada en la página.
- Núcleo Python (FSPL + dos rayos con Fresnel + difracción Deygout + balance de
  enlace) y driver que, a partir de coordenadas y RSSI medido, calibra un sesgo,
  construye el grafo de malla y vuelca un GeoJSON con los SPOF para el visor
  Leaflet.

## Estado

- Modelo validado contra la hoja de la antena (Jinchang JCW435700RA, 3 dBi,
  diagrama H/E) y las cifras del radio (XBee RR: +8 / +19 dBm, −103 dBm; canal 26
  limitado a +3 dBm).
- Pendiente: calibración con el dataset completo de RSSI de El Burgo I (sesgo
  global y n_eff por entorno; L_mod por material).

## Componentes

- Render: `index.html` + `seguidor.js` + `equipos.js` + `sol.js` + `lib/` (three.js vendorizado)
- QA del visor: `tests/test_visor_3d.js` (67 comprobaciones en Chromium)
- QA del núcleo: `tests/test_nucleo.py` (19, incluida la paridad `.py` ↔ `.js`)
- Núcleo + diagnóstico: `python/`
- Port JS + demo de cobertura: `web/`
