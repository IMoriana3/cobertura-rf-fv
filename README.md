# Cobertura RF — Zigbee 2.4 GHz en plantas FV con seguidores

Modelo físico de propagación y herramienta de visualización para los enlaces
Zigbee / 802.15.4 (Digi XBee RR) entre las TCU de los seguidores y las NCU de
una planta fotovoltaica.

Un solo motor físico, tres usos: **siting predictivo**, **diagnóstico** de una
malla real (predicho vs. RSSI medido → grafo → punto único de fallo) y **base**
para validar contra ray tracing.

## Qué incluye

- `index.html` — render 3D interactivo (WebGL, todo vendorizado: se abre sin
  servidor y sin internet) con el **modelo real del seguidor**: patrón de la
  antena sobre el suelo y enlace coloreado por margen real, con la geometría
  bifila parametrizable. Es el "programita" que se abre en el navegador /
  GitHub Pages.
- `seguidor.js` — la **fuente única** del seguidor solar (cotas, piezas y
  materiales) que comparten el gemelo digital, Cobertura 3D y el simulador de
  backtracking. Copia idéntica: mejorarla en un repo mejora todos.
- `equipos.js` — los otros dos extremos de la malla: la **NCU** (armario
  415×515×230 colgado de un poste C de 2,95 m, látigo en la cabeza a 3,15 m) y
  la **HSU** (torre de celosía autoportante de 8 m, ultrasónico y dos látigos a
  ~8,3 m). Cotas de los planos `DR_NCU_v0` y `FTR.24.00145_5_C`, las mismas que
  dibuja `terreno.html` en Cobertura 3D.
- `python/` — núcleo físico + driver de diagnóstico para correr sobre tus datos.
- `web/` — port JS del núcleo (para integrar el cálculo en cualquier HTML) y una
  demo de mapa de cobertura.
- `docs/` — ficha para el panel de proyectos.

## Estructura

```
cobertura-rf-fv/
├── index.html                  # render interactivo (GitHub Pages sirve esto)
├── seguidor.js                 # modelo del seguidor (idéntico en todos los repos)
├── equipos.js                  # modelos de la NCU y la HSU (cotas de plano)
├── lib/                        # three.js r128 + OrbitControls (vendorizados)
├── tests/
│   ├── test_visor_3d.js        # QA del visor en Chromium (48 comprobaciones)
│   └── test_nucleo.py          # núcleo + PARIDAD .py <-> .js (19 comprobaciones)
├── README.md
├── INSTRUCCIONES.md            # cómo usarlo paso a paso
├── python/
│   ├── zigbee_pv_model.py      # núcleo físico (FSPL + dos rayos + difracción + balance)
│   ├── diagnostico_elburgo.py  # coords + RSSI → grafo → SPOF → GeoJSON
│   ├── requirements.txt
│   ├── coords_ejemplo.csv      # plantilla de coordenadas
│   └── rssi_ejemplo.csv        # plantilla de RSSI medido
├── web/
│   ├── zigbee_pv_model.js      # port JS del núcleo (sin dependencias)
│   └── demo-cobertura.html     # mapa de calor de cobertura (autónomo)
├── assets/
│   └── antena_patron.png       # patrón del dipolo (referencia)
└── docs/
    └── cobertura-rf.md         # ficha para el panel
```

## Arranque rápido

**Render:** abre `index.html` en el navegador (o publícalo en GitHub Pages).
Mueve los deslizadores; no necesita servidor ni conexión.

**QA del núcleo** (sin navegador, 1 s — incluye la paridad entre el `.py` y el
port JS, que es lo que se rompe en silencio):

```bash
python3 tests/test_nucleo.py
```

**QA del visor** (necesita `playwright` y un servidor estático):

```bash
python3 -m http.server 8099      # en otra terminal
node tests/test_visor_3d.js
```

**Diagnóstico con tus datos:**

```bash
cd python
pip install -r requirements.txt
python3 diagnostico_elburgo.py coords.csv rssi.csv salida.geojson
```

Sin argumentos corre una demo sintética. El GeoJSON resultante se carga en el
visor Leaflet ("máquina del tiempo") como modo de coloreado predicho / SPOF.

## Física del modelo

Cada enlace se evalúa con pérdida en espacio libre (FSPL), rebote en el suelo
(modelo de dos rayos con coeficiente de reflexión de Fresnel y suelo de
`eps_r`/`sigma` — reproduce los nulos de interferencia y la pendiente d⁴ lejana),
apantallamiento por filas de módulos y topografía (difracción multiobstáculo de
filo de cuchillo, ITU-R P.526, método Deygout) y un margen log-normal calibrable.
De ahí salen el RSSI predicho, el margen sobre sensibilidad y la probabilidad de
enlace; sobre el grafo NetworkX se obtienen los puntos de articulación (SPOF) y
el nodo dominador de rutas.

## Parámetros reales

- **Radio:** Digi XBee RR Zigbee — Tx +8 dBm (estándar) o +19 dBm (PRO),
  sensibilidad −103 dBm (modo normal, 1% PER). En **canal 26** la potencia se
  limita a +3 dBm en ambas variantes.
- **Antena:** Jinchang JCW435700RA — dipolo lineal ≈ λ/2, 3 dBi, 2400–2483,5 MHz.
  Su diagrama (H-plane omnidireccional, E-plane en ocho) confirma el patrón de
  toroide del modelo.
- **Por defecto:** PRO (+19 dBm), 3 dBi en cada extremo, −103 dBm. El cable
  LMR195 de 0,7 m resta ~0,4 dB/extremo (despreciable).

## Los tres extremos de la malla

El visor ya no es solo un campo de seguidores: están los **tres** equipos que
cierran la malla Zigbee de una planta, cada uno con la altura de antena de su
plano, y los saltos entre ellos.

| Equipo | Antena | De dónde sale la cota |
|---|---|---|
| **TCU** | ~0,78 m (viga a 1,50 − caída 0,725) | `seguidor.js`: conector a 0,225 bajo el eje + 0,50 de coax |
| **NCU** | **3,15 m** | `equipos.js`: cabeza del poste C de 2,95 m (plano DR_NCU_v0) |
| **HSU** | **8,33 m** | `equipos.js`: cabeza de la torre de 8 m (plano FTR.24.00145_5_C) |

Esa tabla es el resultado. Una TCU tiene la antena **por debajo** del canto bajo
de su mesa (1,03 m a 30°), y la NCU la tiene **por encima** de la cresta (2,22 m).
Así que:

- **TCU ↔ TCU** — el rayo pasa **por debajo** de las mesas. A 12 m y una fila de
  por medio: 1,4 dB de difracción, margen holgado. Es la razón de que la malla
  entre vecinos funcione aunque el campo parezca un muro.
- **TCU → NCU** — el rayo **cruza** la banda de cada fila que hay en medio. Con
  la NCU a 12 m del borde: 0 mesas para el seguidor de la última fila (69,7 dB),
  2 para el de la tercera (34,1 dB) y 4 para el de la primera (18,2 dB). El
  visor los dibuja los tres a la vez: se ve de un vistazo **hasta dónde llega el
  coordinador directo** y desde dónde hace falta la malla.
- **HSU → NCU** — las dos fuera del campo, sin mesas de por medio.

Un resultado que sale de tener las dos cosas juntas y que no es intuitivo:
**subir la antena de la NCU no siempre mejora**. Por debajo del canto bajo de la
mesa, el salto largo pierde 14,5 dB por difracción; por encima de la cresta,
44 dB. Cruzar la cresta multiplica la difracción por tres. (Y el margen total
tampoco es monótono con la altura, porque el modelo de dos rayos mete sus nulos
de interferencia por el camino: los dos efectos están en la lectura, separados.)

## La mesa como obstáculo

Nada de esto sale si una fila se trata como un muro desde el suelo. Una mesa es
una **placa** entre dos cotas: al inclinarse, su borde bajo baja y su cresta
sube, y un rayo rasante puede pasar por debajo limpio. El núcleo (`.py` y su
port JS) lleva ahora ese obstáculo —`table_band`, `band_clearance`,
`diffraction_loss_tables_db`— encadenado con el Deygout de siempre (ITU-R P.526).

La regla de despeje **no es nueva**: es la de `terreno.html` (Cobertura 3D),
contrastada en su día contra la malla MEDIDA de El Burgo — tratar el campo como
un muro omnidireccional dejaba el 95 % de la planta aislada, contra los 52
enlaces vivos que hay. Lo nuevo es que vive en el núcleo, así que el visor, el
diagnóstico y el siting la comparten. Con **una** mesa a mitad de vano reproduce
exactamente el cálculo de una sola fila intermedia, que es lo que hacía el visor
antes: el número del salto entre vecinos no se mueve.

## El seguidor del render

El visor no dibuja un rectángulo azul: monta el seguidor pieza a pieza con
`seguidor.js` —viga de torsión de 120 mm partida en dos medias vigas, correas
omega con su abarcón, módulos de 1.134 × 2.382 con sus cajas de conexión, slew
drive con reductora y motor, TCU con sus chapas y abarcones, seccionador DC,
pilas y amortiguadores—, en **bifila real**: de cada pareja, solo la viga del
motor lleva TCU y antena, y un eje de transmisión Ø 60 la une con su gemela.

Que sea el modelo de la casa no es estética: **el dibujo y la física hablan del
mismo seguidor**. Dos consecuencias medibles, y las dos cambian números que
antes salían de cotas inventadas en esta página:

- la cara del módulo está a `DIMS.off` = **0,14 m** sobre el eje del tubo (antes,
  0,25 m a ojo). Esa cota entra en `lowerEdge()`, que es el canto que apantalla
  el enlace: si el render usa una y la difracción otra, la imagen se lee como la
  prueba visual de un número que contradice;
- la antena **cuelga donde dice el catálogo**: el coax sale del conector de la
  TCU (0,225 m bajo el eje del tubo) y baja los 0,50 m de `antHang`, así que la
  caída de partida es 0,725 m (0,72 al paso de 1 cm del deslizador), no 0,15 m.
  Con 0,15 m el elemento radiante quedaba *dentro* de la caja de la TCU —
  imposible de ver mientras el seguidor era un rectángulo. A 0,72 m la antena
  queda por debajo del canto bajo del módulo y el
  salto pasa por debajo de las mesas, que es lo que se ve en planta. El
  deslizador sigue recorriendo 0,25–1,50 m para explorar montajes distintos.

El tramo dibujado se elige en el panel: 7 módulos por ala (16,6 m, el corte con
el que se aprecia el detalle), 14 (32,7 m) o los 28 de la **fila real** (64,7 m).
El largo no entra en la física —el balance es una sección transversal— pero sí
marca el encuadre.

## Supuestos y límites

El render asume un plano de módulos por fila, suelo plano y dipolo vertical (el
látigo cuelga hacia abajo, pero al ser el eje vertical radia de costado: nulos
arriba y abajo, máximo en horizontal). El bloqueo del enlace en el render se
modela con la fila intermedia en el punto medio; el núcleo Python encadena todas
las filas reales del salto (Deygout). No incluye curvatura terrestre
(despreciable < 1 km) ni dispersión por vegetación.

Un módulo difracta poco a 2,4 GHz: la onda bordea el borde y el vidrio es casi
transparente; bloquean de verdad el marco de aluminio, el tubo de acero y la
metalización de las células. Por eso los saltos cortos aguantan aunque estén
apantallados, y los fallos de malla aparecen en los saltos largos que cruzan
muchas filas. Los valores absolutos dependen de la calibración: hasta tener el
dataset completo de El Burgo I, el driver ajusta un sesgo global contra el RSSI
medido.
