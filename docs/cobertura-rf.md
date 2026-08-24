# Cobertura RF — Zigbee 2.4 GHz (seguidores)

Modelo físico y visor de los enlaces Zigbee (Digi XBee RR) entre TCU y NCU en
planta. Predice cobertura, diagnostica la malla real (predicho vs. RSSI medido)
y localiza el punto único de fallo.

## Qué hace

- Render 3D interactivo (WebGL) del patrón de la antena sobre el suelo y del
  enlace bifila, coloreado por margen real en dB, con el **modelo real del
  seguidor** (`seguidor.js`, la fuente única que comparten el gemelo digital y
  Cobertura 3D): viga de torsión, correas, módulos, slew drive, TCU, seccionador,
  pilas, amortiguadores y el eje de transmisión de la bifila. Geometría
  parametrizable (inclinación, caída de antena, paso de filas, altura de viga,
  altura de módulo, tramo dibujado, suelo, radio).
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

- Render: `index.html` + `seguidor.js` + `lib/` (three.js vendorizado)
- QA del visor: `tests/test_visor_3d.js` (28 comprobaciones en Chromium)
- Núcleo + diagnóstico: `python/`
- Port JS + demo de cobertura: `web/`
