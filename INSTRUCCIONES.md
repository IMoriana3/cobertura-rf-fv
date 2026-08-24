# Instrucciones

## 1. El render interactivo (`index.html`)

Ábrelo en cualquier navegador (doble clic) o publícalo en GitHub Pages. No
necesita servidor ni internet: three.js y el modelo del seguidor van dentro del
repo.

Lo que ves son **tres seguidores bifila** montados con `seguidor.js`, el modelo
de la casa (el mismo del gemelo digital y de Cobertura 3D): viga de torsión,
correas, módulos, slew drive con su motor, TCU, seccionador, pilas y
amortiguadores. De cada pareja, solo la viga del motor lleva TCU y antena.

Controles:

- **Inclinación** — ángulo de los seguidores (−55° a 55°).
- **Caída de la antena bajo la viga** — cuánto cuelga el látigo por debajo del
  tubo de torsión. Arranca en la cota del modelo (0,725 m: 0,225 m hasta el
  conector de la TCU + 0,50 m de coax). Por debajo de ~0,35 m el elemento
  radiante estaría dentro de la caja de la TCU.
- **Distancia entre filas** — paso entre filas. Las antenas van en las filas
  pares, así que cada salto es 2× este valor y cruza la fila intermedia.
- **Altura de la viga de torsión** — cota del eje de giro.
- **Altura de módulo** — dimensión del módulo a lo largo de la pendiente.
- **Suelo** — conductor perfecto / tierra real (húmeda).
- **Radio** — XBee RR (+8 dBm) / XBee-PRO RR (+19 dBm).
- **Tramo dibujado** — 7 módulos por ala (16,6 m), 14 (32,7 m) o los 28 de la
  fila real (64,7 m). Solo afecta al encuadre: la física es una sección
  transversal y no depende del largo.
- **Encuadre** — Conjunto / Antena / Accionamiento, tres posiciones de cámara.
- **Patrón de la antena** — apaga el toroide para ver el seguidor limpio.

La línea entre antenas se colorea por el margen real (verde holgado → ámbar al
límite → rojo sin enlace) y muestra el valor en dB. Gira la escena con el
ratón/dedo y haz zoom con la rueda.

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
