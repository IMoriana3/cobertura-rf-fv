# Instrucciones

## 1. El render interactivo (`index.html`)

Ábrelo en cualquier navegador (doble clic) o publícalo en GitHub Pages. No
necesita internet: three.js y los modelos van dentro del repo.

> Con doble clic (`file://`) el navegador no deja pedir `tcu.glb` ni
> `secc.json`, así que la TCU y el seccionador salen como caja paramétrica y
> todo lo demás funciona igual. Sirviéndolo (`python3 -m http.server`, o GitHub
> Pages) aparecen con su CAD real, el mismo del gemelo digital.

Lo que ves son los **tres extremos de la malla Zigbee** de una planta:

- **tres seguidores bifila** montados con `seguidor.js`, el modelo de la casa
  (el mismo del gemelo digital y de Cobertura 3D): viga de torsión, correas,
  módulos, slew drive con su motor, TCU, seccionador, pilas y amortiguadores.
  De cada pareja, solo la viga del motor lleva TCU y antena, a ~0,78 m;
- la **NCU** (el coordinador) en su poste C de 2,95 m, con el armario colgado de
  los carriles y el látigo en la cabeza, a **3,15 m**;
- la **HSU** (la meteo) en su torre de celosía autoportante de 8 m, con el
  anemómetro ultrasónico en la cabeza y sus dos látigos en el brazo de
  **6,50 m** — que es donde van, no arriba junto al anemo.

Las cotas de la NCU y la HSU salen de sus planos (`DR_NCU_v0` y
`FTR.24.00145_5_C`) vía `equipos.js`, y son las mismas que dibuja Cobertura 3D.

Y se dibujan los **saltos**: los dos TCU↔TCU, los tres TCU→NCU (directos, uno
por seguidor) y el HSU→NCU. Cada uno con su color, su dB y, en la tabla de
abajo, su desglose: distancia, cuántas mesas cruza, dos rayos y difracción.
La diferencia se ve sola — la TCU tiene la antena **por debajo** del canto bajo
de la mesa y la NCU **por encima** de la cresta, así que un salto entre vecinos
pasa por debajo de las filas y uno al coordinador las cruza.

Controles:

- **Hora solar · Día del año · Latitud** — mueven el sol, y con él los
  seguidores, la luz, el cielo y las sombras. **▶ Reproducir** pasa el día
  entero en unos 17 s; **Amanecer / Mediodía / Ocaso** saltan a las tres horas
  que lo cuentan.
- **Ángulo del seguidor** — *Sigue al sol* (`singleaxis` de pvlib, con stow
  nocturno a 5° al este) o *Manual*, que devuelve el mando al deslizador.
- **Backtracking** — con el paso de fila de la página. A 6 m no llega a entrar
  (el tope de ±55° llega antes); a paso corto sí, y se ve.
- **Inclinación** — ángulo de los seguidores (−55° a 55°). Solo en modo manual:
  con el sol lo manda la hora.
- **Caída de la antena bajo la viga** — cuánto cuelga el látigo por debajo del
  tubo de torsión. Arranca en la cota del modelo (0,725 m: 0,225 m hasta el
  conector de la TCU + 0,50 m de coax). Por debajo de ~0,35 m el elemento
  radiante estaría dentro de la caja de la TCU.
- **Distancia entre filas** — paso entre filas. Las antenas van en las filas
  pares, así que cada salto es 2× este valor y cruza la fila intermedia.
- **Altura de la viga de torsión** — cota del eje de giro.
- **Altura de módulo** — dimensión del módulo a lo largo de la pendiente.
- **NCU: distancia al borde del campo** — dónde está el coordinador.
- **NCU: altura de antena** — arranca en la cota del plano (3,15 m). Bájala por
  debajo del canto bajo de la mesa y verás caer la difracción del salto largo:
  el rayo deja de cruzar las filas y pasa por debajo.
- **HSU: distancia a la NCU** — las dos van fuera del campo.
- **Suelo** — conductor perfecto / tierra real (húmeda).
- **Radio** — XBee RR (+8 dBm) / XBee-PRO RR (+19 dBm).
- **Tramo dibujado** — 7 módulos por ala (16,6 m), 14 (32,7 m) o los 28 de la
  fila real (64,7 m). Solo afecta al encuadre: la física es una sección
  transversal y no depende del largo.
- **Encuadre** — Conjunto / Antena TCU / Accionamiento / NCU / HSU.
- **Patrón de la antena** — apaga el toroide para ver el seguidor limpio.
- **Enlaces a la NCU** — apaga los cuatro saltos al coordinador y deja solo la
  malla entre vecinos.

Cada enlace se colorea por el margen real (verde holgado → ámbar al límite →
rojo sin enlace, y a trazos por debajo de 8 dB) y muestra el valor en dB. El
tramo que queda **bajo una mesa** se dibuja tenue en vez de desaparecer: desde
una cámara alta el panel lo tapa, y sin ese fantasma el haz se lee como una raya
rota cuando lo que hace es pasar por debajo.

Gira la escena con el ratón/dedo y haz zoom con la rueda.

## 2. Diagnóstico de tu malla real (Python)

Necesitas dos CSV.

Coordenadas (`coords.csv`) — cabecera flexible, se auto-detecta:

```
id,x,y,cota          # UTM o metros locales (cota opcional)
id,lon,lat,cota      # o geográficas
```

RSSI medido (`rssi.csv`):

```
origen,destino,rssi_dbm
```

Ejecuta:

```bash
cd python
pip install -r requirements.txt
python3 diagnostico_elburgo.py coords.csv rssi.csv salida.geojson
```

Para probar el flujo con las plantillas incluidas:

```bash
python3 diagnostico_elburgo.py coords_ejemplo.csv rssi_ejemplo.csv salida.geojson
```

Qué hace: calibra un sesgo global predicho-vs-medido, construye la malla (arista
si el margen ≥ 8 dB), detecta los puntos de articulación (SPOF) y el nodo por el
que pasan más rutas, y escribe un GeoJSON con nodos (flag SPOF, rutas que pasan)
y aristas (margen predicho, RSSI medido, probabilidad de enlace).

Para fijar la variante de radio o el gateway, edita `LinkParams` o la llamada
`run(...)` en `diagnostico_elburgo.py`. Por ejemplo, RR estándar y NCU como
gateway:

```python
run("coords.csv", "rssi.csv", "salida.geojson",
    gateway="NCU_01", p=LinkParams(ptx_dbm=8.0))
```

## 2.bis Datos reales tipo El Burgo (routes + log)

Si en vez de RSSI por enlace tienes el RSSI por nodo (`zigbee_log.csv`) y la tabla
de rutas (`zigbee_routes.csv`), usa el adaptador: deriva el RSSI por enlace
cruzando cada nodo con su padre en la ruta, y de paso construye la topología
observada.

```bash
python3 adaptador_elburgo.py coords.csv zigbee_routes.csv zigbee_log.csv elburgo_real
```

Genera `elburgo_real_rssi.csv` (por enlace, listo para `diagnostico_elburgo.py`),
`elburgo_real.geojson` (topología observada con SPOF y dominadores) y un informe
en pantalla: comprobación de la semántica del RSSI, sesgo / sigma / n_eff de la
calibración, dominadores y enlaces más débiles.

## 3. Publicar en GitHub Pages

1. Crea el repo en la org `imoriana3` (p.ej. `cobertura-rf-fv`) y sube el
   contenido.
2. Settings → Pages → Deploy from branch → `main` / `/ (root)`.
3. La herramienta queda en `https://imoriana3.github.io/cobertura-rf-fv/`.

(`index.html` está en la raíz, así que Pages lo sirve directamente.)

## 4. Enganchar al panel de proyectos

1. Copia `docs/cobertura-rf.md` a la carpeta `docs/` del repo del panel (o
   renómbralo al `docId` que uses).
2. Añade la tarjeta en el panel apuntando a la URL de Pages del render y al
   `docId` de la ficha, igual que el resto de herramientas (Demo Siting,
   Cobertura Zigbee El Burgo, etc.).
