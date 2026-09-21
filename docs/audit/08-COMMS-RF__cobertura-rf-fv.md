# Auditoría del modelo físico RF de `cobertura-rf-fv`

## 1. TASK IDENTIFICATION

| Campo | Valor |
|---|---|
| TASK_ID | `08-COMMS-RF__cobertura-rf-fv` |
| TARGET_CHAT | `08_COMMS` |
| Repositorio | `cobertura-rf-fv` |
| Modo | `AUDIT_ONLY_THEN_PERSIST_REPORT` |
| Rama base auditada | `work` |
| Commit base auditado | `05931ba8e1f96c035600a3c61628affbb884eb2a` |
| Fecha de auditoría | 2026-09-21 |
| Alcance de la persistencia | Sólo este informe; no se alteraron código, tests, configuración ni datos |

La rama auditada no contiene una referencia local `main` ni remotos configurados. Por ello, «base» significa exactamente el `HEAD` recibido (`work`), no una afirmación de equivalencia con el `main` remoto.

### Taxonomía usada

- **PHYSICAL_CALCULATION:** ecuación física ejecutable.
- **APPROXIMATION:** simplificación numérica o geométrica explícita.
- **DESIGN_RULE:** umbral o criterio de ingeniería, no ley física.
- **MEASURED_DATA:** observación de campo conservada.
- **CALIBRATION:** parámetro estimado contra observaciones.
- **CONFIGURED_TOPOLOGY:** asociación/equipo/posición declarada en layouts o rutas.

Clasificación de implementaciones: **CANONICAL**, **MIRROR**, **ADAPTER**, **LEGACY**. Clasificación de discrepancias: **INTENTIONAL**, **APPROXIMATION**, **LEGACY**, **BUG**, **UNKNOWN**.

## 2. EXECUTIVE FINDINGS

1. El motor numérico realmente usado es **dos rayos coherente sobre suelo plano + difracción Deygout truncada + corrección de patrón de dipolo + balance escalar**. Aunque se exporta FSPL, `predict_link`/`predictLink` no encadena FSPL por separado: el término directo de dos rayos ya contiene la propagación de espacio libre.
2. Python (`python/zigbee_pv_model.py`) es la implementación **CANONICAL de cálculo/diagnóstico** y JavaScript (`web/zigbee_pv_model.js`) su **MIRROR manual** para navegador. El visor y la demo son **ADAPTERS geométricos**. La paridad probada cubre seis casos y calibración, pero no toda la superficie de parámetros.
3. La obstrucción de mesas es una aproximación 2.5D: cada fila intersectada es una banda vertical entre borde bajo y alto; no hay electromagnetismo de módulos, espesor, metal, scattering, transmisión ni orientación real del material. El algoritmo elige el borde próximo al rayo y aplica knife-edge/Deygout con profundidad máxima 3.
4. El terreno sólo entra cuando el llamador suministra obstáculos/cotas. En el visor de plantas, el relieve fija cotas de extremos y mesas, pero **no se muestrea el perfil continuo del terreno como obstáculo de difracción** en los enlaces directos TCU→NCU. El diagnóstico de El Burgo calibra sobre suelo plano, sin mesas ni terreno.
5. No existe decisión LOS explícita, despeje de un porcentaje de Fresnel, diffraction por volumen, clutter/vegetación, edificios, lluvia, curvatura, diversidad, fading temporal, interferencia, orientación/tilt real de los látigos ni cable loss separado. El radio de Fresnel es una utilidad informativa; la zona de Fresnel no determina bloqueo.
6. La calibración vigente `−16.58 dB, σ=10.99 dB` se reproduce con los 49 enlaces del CSV usando antenas TCU a 0.775 m, suelo real, sin obstrucciones. El artefacto `elburgo_real.geojson` conserva otra ejecución: `−33.63 dB, σ=6.82 dB, n_eff=0.38`. El adaptador declara 1.5 m, pero el núcleo actual con esa configuración da `−24.62/8.63`: la ejecución histórica exacta no es reproducible. Ambos pares se atribuyen al mismo dataset derivado de rutas/log de El Burgo I; el segundo artefacto está desactualizado respecto del núcleo vigente.
7. Las 49 observaciones son únicamente enlaces con padre dominante y RSSI disponible: una muestra seleccionada por el enrutamiento. No contiene ensayos dirigidos fallidos, límites de detección ni observaciones censuradas explícitas. Tres aristas observadas del GeoJSON tienen RSSI nulo, pero no entran en el CSV/calibración y no codifican «fallo de recepción».
8. El ajuste de offset reproduce la media por construcción, pero no la forma/ranking. En reproducción local, Pearson(predicho, medido) = `−0.163` y Spearman = `−0.243`; el predictor es casi sólo distancia (Pearson con log-distancia `−0.998`) mientras el RSSI medido tiene `+0.164`. Por tanto no hay evidencia de capacidad de ranking; la evidencia disponible apunta en sentido contrario.
9. La probabilidad `Φ(margen/σ)` es una **APPROXIMATION** log-normal sin validación de eventos éxito/fracaso. El umbral de arista `margen ≥ 8 dB`, el padre usado ≥5 %, los defaults de suelo y el modo de radio son **DESIGN_RULE/CONFIGURATION**, no resultados medidos.
10. Hay un **BUG material** en el patrón: se calcula un único ángulo de elevación del rayo directo y la misma corrección se aplica a Tx y Rx. No se evalúan los ángulos distintos de salida/llegada del rayo reflejado; por tanto la suma coherente directo/reflejado se forma antes del patrón y no es consistente con el modelo de antena. Tampoco se incorpora orientación real de cada antena.
11. Los repetidores están en layouts y se renderizan, pero no participan en el cálculo de cobertura/topología. Los enlaces TCU–TCU, TCU–NCU y HSU–NCU se calculan en el corte didáctico; en modo planta sólo se evalúa TCU→NCU directo. No se calculan TCU–HSU ni enlaces de repetidor.
12. No fue posible contrastar ejecutablemente `siting` ni `SolarGPTfull/factiun_core.rf`: esos repos/módulos no están presentes, no hay remoto y no hay snapshot vendorizado. Las afirmaciones de comentarios sobre `terreno.html` no son prueba y quedan como comparación requerida, no resuelta.

## 3. RF EQUATION CHAIN

### 3.1 Cadena ejecutada

Para separación horizontal `d`, alturas locales `h_t,h_r`, frecuencia `f` y `λ=c/f`:

1. **Distancia directa y reflejada** (**PHYSICAL_CALCULATION**):
   - `d_los = √(d² + (h_t-h_r)²)`
   - `d_ref = √(d² + (h_t+h_r)²)`
   - suelo implícitamente plano, común y a cota local cero.
2. **Permitividad compleja y Fresnel** (**PHYSICAL_CALCULATION + APPROXIMATION**): `ε = ε_r − j·60·λ·σ_ground`; se calcula `Γ_v` o `Γ_h` en el ángulo rasante `atan2(h_t+h_r,d)`. `ε_r=∞` fuerza `Γ=+1` como caso de conductor perfecto.
3. **Campo de dos rayos** (**PHYSICAL_CALCULATION**):
   `E = 1/d_los + Γ·exp(−j·2π(d_ref−d_los)/λ)/d_ref`.
   La pérdida es `L_2ray = −20 log10[(λ/4π)|E|]`.
4. **Difracción** (**PHYSICAL_CALCULATION aproximada**): para cada obstáculo se calcula
   `v = h_clear √[2(d1+d2)/(λ d1 d2)]`; si `v > −0.78`, se usa la aproximación knife-edge `6.9 + 20log10(√((v−0.1)²+1)+v−0.1)`. Deygout selecciona el mayor `v` y recurre a izquierda/derecha, máximo tres niveles.
5. **Pérdida total**: `L_total = L_2ray + L_diff_terrain/obstacles + L_diff_tables + L_mod`.
6. **Patrón** (**APPROXIMATION**): para elevación directa `e`, `F(e)=cos[(π/2)sin(e)]/cos(e)` y `G_rel=20log10|F|`, limitado a `−60 dB`. El mismo `G_rel` se suma en ambos extremos.
7. **Balance**: `P_rx = P_tx + G_tx + G_rel + G_rx + G_rel − L_total`; `margin=P_rx−sensitivity`.
8. **Incertidumbre** (**CALIBRATION/APPROXIMATION**): `p_link=Φ(margin/σ_db)`.

### 3.2 FSPL, path loss y Fresnel

- `fspl_db(d,f)=20log10(d)+20log10(f)−147.55` es correcta para metros/Hz y está probada sólo indirectamente/demostrada; es utilidad exportada, no un sumando de `predict_link`.
- La función de breakpoint `4h_th_r/λ` también es informativa: no conmuta entre fórmulas.
- `fresnel_radius` calcula zonas de Fresnel, pero ningún flujo usa un criterio 60 %, despeje o LOS derivado de ella.
- No hay modelo log-distance con exponente configurable. `n_eff` sólo se estima como diagnóstico en el adaptador; no se realimenta al predictor.

### 3.3 LOS, reflexión y difracción

- **LOS:** implícita en el rayo directo; no existe estado LOS/NLOS ni ray casting 3D.
- **Reflexión:** una sola reflexión especular en suelo plano homogéneo. La topografía absoluta no modifica el punto/ángulo reflejado.
- **Difracción:** obstáculos puntuales y bandas de mesa se suman a la pérdida de dos rayos. Esto supone independencia aditiva entre reflexión y difracción; no existe campo complejo difractado.
- **ITU-R P.526:** aparece la aproximación de pérdida de un filo y una variante recursiva Deygout, pero no una implementación completa y versionada de P.526 (sin Tierra esférica, Bullington/delta-Bullington, subtrayectos normalizados ni validación contra tablas oficiales). La etiqueta «P.526» debe entenderse como procedencia de la aproximación knife-edge, no conformidad integral.

### 3.4 Uncertainty

`sigma_db=6` es default configurado sin provenance medido. `10.99 dB` es desviación poblacional del residuo de los 49 enlaces seleccionados bajo la configuración vigente. No se modelan incertidumbres separadas de posición, altura, suelo, potencia, sensibilidad, orientación o correlación espacial/temporal. `p_link` interpreta sigma como dispersión gaussiana alrededor de un margen determinista, sin comprobar independencia ni calibración probabilística.

## 4. GEOMETRY / TERRAIN / OBSTRUCTION MODEL

### 4.1 Mesas, trackers y módulos

`table_band` representa una mesa por:

- centro vertical `ground + axis_h + off·cos(|tilt|)`;
- semialtura `chord/2·sin(|tilt|)`;
- semihuella `chord/2·cos(|tilt|)`.

El visor de planta agrupa seguidores en líneas en el marco del azimut de eje, intersecta la recta del enlace con cada plano de fila y comprueba si hay un tracker dentro de su longitud más 1 m. Es una buena corrección geométrica frente a tratar toda fila como muro infinito, pero sigue siendo **APPROXIMATION**: banda vertical sin espesor ni azimut electromagnético, el `abs(tilt)` borra qué borde está alto, y la huella sólo se usa para cruce espacial, no para trayecto dentro del material.

`l_mod_db` existe, vale cero y se suma una vez por enlace, no una vez por módulo atravesado. Por ello actualmente no hay pérdida de penetración material efectiva.

### 4.2 Terreno

- El núcleo acepta `terrain=[(x,cota)]`, idéntico a obstáculos knife-edge.
- `diagnostico_elburgo.py`, `calibra_elburgo.py` y `adaptador_elburgo.py` no suministran perfiles; usan terreno cero.
- El modo planta usa cotas de layout/levantamiento/DEM para apoyar equipos y formar la cota de cada banda. En la llamada RF pasa `terrain=null`; un cerro entre filas que no coincida con una mesa no difracta.
- Las fuentes de elevación varían por planta (levantamientos en JSON y DEM/cache para otras). Son **MEASURED_DATA** sólo donde hay levantamiento identificado; DEM, interpolaciones, emparejamientos y fallback son **APPROXIMATION/CONFIGURED_TOPOLOGY**. La precisión RF de esos datos no está caracterizada.

### 4.3 Tipos de enlace y topología

| Enlace | Implementación efectiva |
|---|---|
| TCU–TCU | Calculado sólo en el corte didáctico entre las tres TCU mostradas; no construye la malla real de planta. |
| TCU–NCU | Calculado en corte y para cada tracker de planta contra la NCU/mástil asignada por `(ncu,gw)`. |
| TCU–HSU | No implementado. |
| HSU–NCU | Calculado sólo en el corte didáctico, sin mesas. |
| Repetidores | Posiciones configuradas/renderizadas en algunas plantas; ningún enlace RF ni efecto en cobertura. |

Los layouts contienen TCU/trackers, NCU, HSU, repetidores y grupos. Eso es **CONFIGURED_TOPOLOGY**, no evidencia de que exista enlace ni de que la asociación represente rutas observadas. En El Burgo hay además topología observada derivada de rutas, separada del layout de siting.

## 5. ANTENNA MODEL

- **Ganancia:** 3 dBi por extremo, configurada como pico de catálogo.
- **Patrón:** dipolo ideal de media onda, sólo plano de elevación, azimut omnidireccional. Es **APPROXIMATION**, no tabla digitalizada de la antena Jinchang ni patrón instalado.
- **Orientación:** el cálculo supone ambos ejes verticales. El dibujo mantiene el látigo TCU vertical al colgarlo, aunque los comentarios reconocen basculación; no se usa orientación individual de TCU/NCU/HSU, polarización cruzada, mast shadowing ni estructura cercana.
- **Directo/reflejado:** **BUG**. La corrección `G_rel` del ángulo directo se aplica después de sumar los campos y por igual a Tx/Rx. Un modelo consistente necesita ganancias complejas o al menos escalares distintas para salida/llegada de directo y reflejado antes de la suma. En antenas a distinta altura, los ángulos reflejados no son el ángulo directo.
- **Visualización:** el toroide dibujado combina dipolo y reflexión con otra función local. Es visual, no la fuente del presupuesto y no demuestra equivalencia numérica con `predictLink`.

## 6. EQUIPMENT PARAMETERS

| Parámetro | Valor efectivo | Clase / observación |
|---|---:|---|
| Frecuencia | 2.45 GHz | **CONFIGURATION**; no canal específico ni ancho de banda. |
| Tx XBee-PRO RR | +19 dBm | **CONFIGURATION** default del núcleo/visor. |
| Tx RR estándar | +8 dBm | Opción del visor. |
| Canal 26 | comentario: +3 dBm | No hay selección de canal ni enforcement en núcleo: **DESIGN_RULE no ejecutada**. |
| Ganancias | 3 dBi + 3 dBi | **CONFIGURATION**, corregidas por patrón ideal. |
| Sensibilidad | −103 dBm | **CONFIGURATION**. No depende de data rate/PER/canal/temperatura. |
| Cable loss | 0 dB efectivo | README menciona ~0.4 dB/extremo, pero no existe parámetro separado ni descuento. **BUG/omisión material** si 3 dBi es ganancia antes del cable. |
| Suelo | `εr=15`, `σ=5e−3 S/m` | **CONFIGURATION/APPROXIMATION**, sin medición por planta/estación. El visor didáctico arranca además en PEC. |
| Pérdida módulo | 0 dB | Placeholder de calibración, no ajustado. |
| Sensibilidad de diseño | margen ≥8 dB | **DESIGN_RULE** para aristas/estado; no sensibilidad RF. |

### Alturas y provenance

- **TCU:** eje 1.50 m menos caída 0.725 m = 0.775 m en la calibración/corte default. La caída se compone de 0.225 m hasta conector + 0.50 m de coax/modelo. El repo no contiene el plano/ficha fuente; `seguidor.js` es fuente interna, no evidencia primaria.
- **NCU:** 3.15 m al centro del látigo; `equipos.js` atribuye 2.95 m del poste al plano `DR_NCU_v0`, no incluido.
- **HSU:** 6.50 m al centro de los látigos; el comentario atribuye confirmación personal de agosto de 2026 y plano `FTR.24.00145_5_C`, ninguno incluido. El encabezado de `equipos.js` aún dice ~8.3 m, contradicción **LEGACY** documental dentro del mismo fichero.
- `diagnostico_elburgo.py` usa 1.5 m para todos los nodos; `adaptador_elburgo.py` también. Esto contradice el modelo canónico vigente de TCU 0.775 m y no distingue coordinador: **LEGACY/BUG** material.

## 7. MEASURED DATA AND CALIBRATION

### 7.1 Qué datos existen

- `elburgo_real_rssi.csv`: 49 pares padre dominante→hijo, RSSI mediano redondeado, rango `−87..−58 dBm`.
- `plantas/elburgo_coords.csv`: coordenadas geográficas usadas para distancia.
- `elburgo_real.geojson`: 53 puntos, 52 aristas observadas, 406,457 filas de rutas y 8,053 snapshots declarados; 49 aristas tienen RSSI y 3 no.
- No están en el repo los `zigbee_routes.csv` ni `zigbee_log.csv` originales que el adaptador dice procesar. Por tanto no se puede reconstituir el CSV/GeoJSON desde fuentes brutas, comprobar timestamps, unidades, duplicados, representatividad, RSSI exacto antes de mediana/redondeo o semántica de `ack_failures`. La provenance es incompleta.

### 7.2 Relación entre −33.6 y −16.58 dB

Sí proceden de la misma campaña/dataset derivado de El Burgo I NCU1, pero no del mismo cálculo:

| Resultado | Configuración reproducible | Estado |
|---|---|---|
| `−33.63 dB`, `σ=6.82`, `n_eff=0.38` | Artefacto GeoJSON generado por una ejecución histórica del adaptador, que declara antenas iguales a 1.5 m, suelo real, dos rayos, padre dominante y 49 enlaces. | **LEGACY** persistido; no reproducible con el núcleo actual. |
| `−33.6 dB`, `σ≈6.8` | Fue copiado al JS como calibración, pero no corresponde a la configuración documentada actual; probablemente proviene del artefacto anterior más otra diferencia histórica no trazada. | **UNKNOWN/LEGACY**, no usar como verdad. |
| `−24.62 dB`, `σ=8.63` | 1.5 m, suelo real, núcleo actual (incluye patrón, irrelevante a igual cota). | Reproducible, pero incompatible con `−33.63`: evidencia de deriva del núcleo desde la generación del GeoJSON. |
| `−16.58 dB`, `σ=10.99` | 0.775 m, suelo real, núcleo actual, 49 enlaces. | **CALIBRATION vigente**, reproducida por test. Sólo recentrado de supervivientes. |
| `−15.49 dB`, `σ=10.45` | 1.5 m, PEC. | Sensibilidad de escenario, no calibración elegida. |
| `−26.51 dB`, `σ=6.72` | 0.775 m, PEC. | Sensibilidad de escenario, no calibración elegida. |

La fuerte variación por altura/suelo demuestra que el offset absorbe hipótesis físicas. No es portable entre TCU–TCU, TCU–NCU, HSU o plantas.

### 7.3 Exponente, correlación y forma

- El adaptador guardó `n_eff=0.38` usando la convención `RSSI=a−10n log10(d)` sobre su ejecución histórica.
- El script vigente imprime pendiente `+3.7 dB/década`, Pearson `r=+0.164` y `n_eff=−0.18`; esta diferencia de definición/artefacto confirma que el `n_eff=0.38` persistido no es reproducible con el CSV y código actuales.
- Auditoría independiente del predictor vigente a 0.775 m: Pearson predicho–medido `−0.163`, Spearman `−0.243`, predictor–log(distancia) `−0.998`. El ajuste de bias no cambia ninguna correlación o ranking.
- Residuos medios después del bias: `−21.8 dB` (0–60 m), `−7.1` (60–120), `+6.1` (120–200), `+13.7` (200–400). La forma no se reproduce.

### 7.4 Censoring y fallos

El adaptador asigna a cada nodo el RSSI mediano y el padre más frecuente observado. Por construcción sólo entran enlaces que aparecieron en rutas y tuvieron RSSI. `ack_failures` se agrega por nodo pero no se transforma en intentos fallidos por enlace, no entra al fit y no existe denominador. Las 3 aristas sin RSSI del GeoJSON no están etiquetadas como fallo y podrían ser primeros saltos/ausencia de medición. No existen no-recepciones con umbral, paquetes transmitidos/recibidos, PER o left-censoring. La calibración está afectada por selection/survivorship bias y no identifica alcance.

## 8. PYTHON / JAVASCRIPT PARITY

### Clasificación

| Componente | Clase | Razón |
|---|---|---|
| `python/zigbee_pv_model.py` | **CANONICAL** | Núcleo legible usado por calibración/diagnóstico y referencia de tests. |
| `web/zigbee_pv_model.js` | **MIRROR** | Port manual de las mismas ecuaciones; no generado. |
| `index.html` | **ADAPTER** | Genera geometría/obstáculos, configura parámetros y pinta resultados. |
| `web/demo-cobertura.html` | **ADAPTER** | Consume el mirror para mapa simplificado plano. |
| `diagnostico_elburgo.py` | **ADAPTER + LEGACY** | Ingesta/grafo, pero altura uniforme 1.5 m y sin obstáculos. |
| `adaptador_elburgo.py` | **ADAPTER + LEGACY** | Convierte rutas/log; altura 1.5 m y artefactos ya no equivalen al núcleo actual. |
| `elburgo_real.geojson` | **LEGACY artifact** | Contiene calibración `−33.63/6.82` incoherente con constantes actuales. |

### Paridad real y huecos

El test compara `pl_2ray`, `pl_diff` y margen redondeados a 0.01 dB para seis escenarios (PEC/tierra, alturas y mesas), más parámetros/margen/probabilidad calibrados. También prueba el patrón en Python. No compara exhaustivamente:

- FSPL, wavelength, Fresnel radius y breakpoint entre puertos;
- ambas polarizaciones, conductividades/frecuencias variadas y números complejos extremos;
- `terrain`/`obstacles` simples y multiborde separados de `tables`;
- profundidad Deygout, orden/permutación de obstáculos y reversibilidad Tx↔Rx;
- `l_mod_db`, sensibilidad, ganancias asimétricas, `antPatron=iso` en JS;
- outputs no finitos, distancia cero, sigma cero/negativa;
- grafo, calibración genérica o adapters.

La probabilidad difiere potencialmente en los últimos decimales: Python usa `math.erf`; JS Abramowitz–Stegun. El test sólo exige tolerancia 0.0011.

## 9. TEST EVIDENCE

### Evidencia positiva

- `python3 tests/test_nucleo.py`: 38/38 checks. Cubre banda de mesa, pérdida knife-edge de una mesa, régimen TCU–NCU, cotas, reproducción de `−16.58/10.99`, seis casos Python/JS y patrón ideal.
- `python3 python/calibra_elburgo.py`: reproduce los cuatro escenarios de altura/suelo, la falta de dependencia con distancia y residuos por tramos.
- CI define jobs separados para núcleo y navegador, con tests del visor, bifila/plantas, demo, careo DEM e imagen. El workflow es evidencia de intención de ejecución, no del estado de un run concreto; no hay resultados/artefactos de CI en el checkout.

### Límites de tests

- Muchos asserts codifican los valores del propio algoritmo; demuestran estabilidad/paridad, no validez física contra referencia independiente.
- No hay golden cases de ITU-R P.526 ni comparación con solver/ray tracing/medidas controladas.
- La reproducción de calibración prueba la media y sigma del mismo conjunto usado para ajustar: no hay train/test split, cross-validation, intervalos ni evaluación de ranking.
- No hay test de enlaces fallidos/censurados, cable loss, canal 26, repetidores, TCU–HSU, patrón del reflejado, orientación o perfil continuo del terreno.
- Las pruebas de navegador inspeccionan geometría/UI y snapshots; no convierten comentarios de provenance en evidencia.

## 10. DISCREPANCIES

| ID | Discrepancia | Clase | Impacto |
|---|---|---|---|
| D01 | GeoJSON dice `−33.63/6.82/n_eff 0.38`; núcleo dice `−16.58/10.99`. | **LEGACY** | Dos «calibraciones El Burgo» coexistentes y consumibles. |
| D02 | `diagnostico` y `adaptador` usan 1.5 m para todas las antenas; canónico TCU usa 0.775 m y NCU 3.15 m. | **BUG/LEGACY** | Cambia interferencia de dos rayos y bias decenas de dB. |
| D03 | Patrón directo aplicado a todo el campo directo+reflejado y repetido en Tx/Rx. | **BUG** | Nulos/crestas y enlaces con elevación no son físicamente consistentes. |
| D04 | Cable LMR195 ~0.4 dB/extremo sólo documentado. | **BUG** | Presupuesto ~0.8 dB optimista si las ganancias son antes del feeder. |
| D05 | `l_mod_db` se suma una vez y vale 0; no existe pérdida por número/material de módulos. | **APPROXIMATION** | Obstrucción de panel se reduce a difracción de bordes. |
| D06 | Terreno de planta no se pasa como perfil de obstáculos a `predictLink`. | **BUG/APPROXIMATION** | Cerros entre equipos pueden omitirse salvo coincidencia con fila. |
| D07 | Repetidores dibujados/configurados pero sin enlaces. | **BUG** respecto al alcance anunciado | No evalúa una parte solicitada de la red. |
| D08 | Modo planta sólo pinta TCU→NCU directo, no malla TCU–TCU. | **INTENTIONAL** en UI, limitación material | No predice conectividad real ni rescate por mesh. |
| D09 | PEC es default inicial del corte; suelo real lo es en núcleo. | **INTENTIONAL**, riesgoso | Produce rizado/nulos enormes y resultados no comparables por default. |
| D10 | Canal 26 +3 dBm sólo en comentario. | **BUG** si se selecciona/usa canal 26 | Puede sobreestimar 16 dB respecto a PRO default. |
| D11 | Encabezado HSU dice antenas ~8.3 m; constante usa 6.50 m. | **LEGACY** documental | Provenance ambigua. |
| D12 | `n_eff=0.38` persistido vs `−0.18` reproducido actualmente. | **LEGACY/UNKNOWN** | No hay trazabilidad de versión/ecuación del artefacto. |
| D13 | FSPL anunciado en cadena, pero predictor usa dos rayos directamente. | **INTENTIONAL** matemáticamente | La documentación puede inducir doble conteo al integrar. |
| D14 | Máxima profundidad Deygout 3 fija. | **APPROXIMATION** | Pérdida deja de acumular después de tres niveles dominantes. |
| D15 | Sumatorio de difracción de terreno y mesas por separado. | **APPROXIMATION** | No selecciona obstáculo dominante sobre el conjunto combinado. |
| D16 | `rssi_meas = lookup(...) or lookup(...)` perdería un valor 0 dBm. | **BUG menor** | No afecta RSSI negativo actual; patrón de código incorrecto. |
| D17 | No se conservan fuentes brutas de campaña. | **UNKNOWN/provenance gap** | Auditoría independiente y regeneración imposibles. |

## 11. VALIDITY ENVELOPE

### Uso defendible hoy

- Comparación **relativa y exploratoria** de geometrías similares a 2.45 GHz, distancias de escala planta y suelo aproximadamente plano/homogéneo.
- Estudio de sensibilidad a altura, inclinación, separación, suelo supuesto y presencia aproximada de filas.
- Visualización del mecanismo cualitativo TCU bajo mesas frente a NCU sobre mesas.
- Verificación de paridad de los casos cubiertos entre núcleo Python y navegador.

### No defendible sin nueva evidencia

- Predicción absoluta de RSSI, probabilidad de enlace, alcance o disponibilidad contractual.
- Ranking de enlaces reales: los datos presentes no lo validan.
- Dimensionado de repetidores, conectividad mesh completa, SPOF predicho o enlace TCU–HSU.
- Plantas con relieve obstructivo continuo, vegetación/edificios, suelo variable, humedad estacional o fuerte multipath industrial.
- extrapolación a otras frecuencias/canales/radios/antenas o canal 26 sin ajustar potencia.
- Interpretar `p_link` como PER/fiabilidad temporal o `8 dB` como umbral empírico universal.
- Usar bias/sigma El Burgo fuera de los enlaces supervivientes de esa campaña.

Hasta validar, la salida debe etiquetarse como **candidate relative RF score**, no «margen real» ni predicción calibrada.

## 12. REQUIRED COMPARISONS AGAINST SITING AND SolarGPTfull

No hay copia ejecutable de `siting`, `SolarGPTfull` ni `factiun_core.rf` en este workspace, tampoco remoto del que obtenerlas. Por tanto no se atribuyen diferencias basándose en comentarios. Comparación requerida antes de declarar verdad compartida:

1. Fijar commits exactos de los tres repos y extraer vectores canónicos de entrada/salida.
2. Comparar unidades, constante FSPL, distancia 2D/3D, frecuencia/canal y tratamiento de distancia cero.
3. Comparar `Γ` (convención angular, polarización, permitividad compleja, signo/fase) y si se usa campo coherente o fórmula asintótica d⁴.
4. Comparar patrón por cada trayectoria y extremo, orientación instalada, azimut/elevación y ganancias/cables.
5. Comparar alturas TCU/NCU/HSU y su provenance primaria; verificar si siting conserva 1.5 m, HSU 8.33 m u otras cotas.
6. Comparar construcción de mesas: banda, borde alto, muro, penetración, longitud finita, inclinación con signo y marco de azimut.
7. Comparar perfil de terreno, interpolación DEM, curvatura, Fresnel/LOS y variante exacta de P.526/Deygout.
8. Comparar topología `(NCU,GW)`, TCU–TCU, HSU y repetidores; separar enlace directo de conectividad mesh.
9. Ejecutar matriz común: FSPL; dos rayos sin obstáculos; una/múltiples mesas; cerro; Tx/Rx invertidos; TCU/NCU/HSU; PEC/tres suelos; 2.405/2.45/2.48 GHz; canales/potencias.
10. Para `factiun_core.rf`, decidir si es **CANONICAL** corporativo. Si lo es, este repo debe ser adapter/mirror generado, no tercera implementación manual.

**Estado de comparación:** `BLOCKED BY ABSENT ARTIFACTS`, no equivalencia ni diferencia demostrada. Diferencias materiales ya sospechadas y que deben comprobarse: alturas uniformes vs por equipo; patrón isotrópico vs dipolo; suelo/reflexión; mesas como muro vs banda; perfil continuo de terreno; cable losses; calibración histórica `−33.6`; repetidores/topología.

## 13. CANDIDATE RF TRUTH

La siguiente es la verdad candidata mínima que sí describe el ejecutable auditado, no una validación de campo:

1. **Motor:** Python canónico y mirror JS calculan a 2.45 GHz un campo coherente directo + una reflexión en suelo plano Fresnel, y convierten su módulo en path loss.
2. **Obstáculos:** agregan pérdida knife-edge/Deygout aproximada para puntos de terreno/obstáculo suministrados y, por separado, bandas verticales de mesas intersectadas; profundidad 3.
3. **Antena:** suman ganancias pico 3 dBi y una corrección de dipolo ideal basada sólo en la elevación directa; ésta es provisional por inconsistencia con la trayectoria reflejada y orientación.
4. **Equipo default:** +19 dBm, −103 dBm, sin cable loss, suelo `εr=15, σ=0.005 S/m`, sigma 6 dB. Son configuración, no medición del sitio.
5. **Geometría candidata:** TCU 0.775 m con eje a 1.5 m; NCU 3.15 m; HSU 6.50 m. Provenance primaria pendiente.
6. **Salida:** RSSI y margen deterministas; `p_link` es transformación normal heurística. Umbral operativo de visualización/grafo: 8 dB.
7. **Calibración opcional:** `−16.58 dB`, `σ=10.99 dB`, exclusivamente como recentrado descriptivo de 49 enlaces usados por la malla de El Burgo I. No valida alcance, ranking ni probabilidad.
8. **Topología:** layouts son configuración; rutas de El Burgo son observación derivada. No deben mezclarse ni inferirse fallos no observados.

Antes de promover esta candidata a verdad RF, se deben corregir D02–D07, fijar provenance, comparar los tres motores y validar ciegamente con una campaña diseñada que incluya recepciones y no-recepciones.

## 14. QUESTIONS TO 08_COMMS AND 00_MASTER

### A `08_COMMS`

1. ¿Cuál es el commit y repositorio canónico de `siting` y de `SolarGPTfull/factiun_core.rf`? ¿Qué implementación tiene autoridad normativa?
2. ¿Dónde están los brutos `zigbee_routes.csv`/`zigbee_log.csv`, diccionario de campos, zona horaria, firmware, canal, potencia configurada, tipo de XBee y periodo de campaña de El Burgo?
3. ¿El RSSI es del último salto, del coordinador, LQI convertido o lectura local del nodo? ¿Quién mide Tx→Rx y en qué dirección?
4. ¿Hay conteos por intento, paquetes perdidos, timeouts, ACK failures por enlace y límite inferior/reporting floor del RSSI? Sin ellos no puede modelarse censoring.
5. ¿Los 49 pares son todos los padres dominantes de NCU1, y los tres enlaces sin RSSI por qué carecen de medida?
6. ¿Cuál fue exactamente la versión/configuración que generó `−33.63/6.82/n_eff=0.38`? El artefacto y el código actual no la reproducen.
7. ¿Se confirma que TCU opera a +19/+8/+3 dBm según variante/canal durante la campaña? ¿Qué pérdidas reales hay en conectores/coax y cuál es la ganancia instalada?
8. ¿Los látigos son verticales en servicio? Aportar fotos/plano y orientación para TCU, NCU, HSU y repetidores.
9. ¿Se puede aportar la hoja del JCW435700RA digitalizada o medición instalada, incluidos ambos planos, eficiencia, mismatch y patrón con estructura?
10. ¿Qué suelos/humedades y perfiles de terreno representan cada planta? ¿Cuál es el criterio aceptado de Fresnel/LOS y la variante P.526?
11. ¿Debe el producto predecir mesh real o sólo cobertura directa al coordinador? Definir enlaces requeridos TCU–TCU, TCU–NCU, TCU–HSU, HSU–NCU y repetidor.
12. ¿El margen de 8 dB procede de especificación, experiencia, PER objetivo o simple regla de diseño?

### A `00_MASTER`

1. Confirmar la política de fuente única: ¿`factiun_core.rf` debe ser CANONICAL y este repo MIRROR/ADAPTER?
2. Proporcionar commits auditables de `siting` y `SolarGPTfull`, además de los planos/fichas citados y sus licencias/provenance.
3. Definir nomenclatura obligatoria en UI/reportes: evitar «margen real» y «validado» hasta disponer de validación independiente.
4. Aprobar una campaña de validación estratificada por distancia, orientación, inclinación, número de filas, relieve y tipo de equipo, incluyendo intentos fallidos y medición del noise floor/interferencia.
5. Definir métricas de aceptación antes del fit: bias y RMSE en holdout, Pearson/Spearman de ranking, calibración/Brier de probabilidad, recall de fallos y error por clase de enlace.
6. Decidir si los artefactos legacy `−33.63/6.82` deben conservarse explícitamente como históricos o regenerarse con metadata de versión; no deben coexistir sin etiqueta con `−16.58/10.99`.

---

### Dictamen

El repositorio contiene un modelo físico útil como **prototipo comparativo**, con buena trazabilidad interna de ecuaciones y paridad parcial Python/JS, pero no un modelo RF absoluto validado. La evidencia medida disponible está censurada por el enrutamiento, no reproduce forma/ranking y no incluye fallos. La prioridad no es ajustar otro offset: es fijar una fuente canónica común, corregir geometría/equipos/patrón, preservar brutos y validar contra una campaña diseñada y contra `siting`/`factiun_core.rf` en commits concretos.
