"""
zigbee_pv_model.py
==================
Núcleo físico de propagación para enlaces Zigbee/DigiMesh a 2.4 GHz
(XBee ZB / IEEE 802.15.4) en plantas fotovoltaicas con seguidores.

Un solo motor, tres usos:
  1. Siting predictivo (predecir cobertura desde coordenadas).
  2. Diagnóstico (predicho vs. RSSI medido -> grafo de malla -> SPOF).
  3. Base de alta fidelidad (calibrar y validar contra ray tracing).

Mecanismos modelados:
  - Pérdida en espacio libre (FSPL).
  - Rebote en el suelo: modelo de dos rayos con coeficiente de reflexión
    de Fresnel (polarización vertical/horizontal, suelo con eps_r y sigma).
  - Apantallamiento por módulos + topografía: difracción multiobstáculo
    (filo de cuchillo, ITU-R P.526, método Deygout).
  - Penetración por módulo (constante calibrable).
  - Margen estadístico de desvanecimiento (log-normal, sigma).

No incluye: curvatura terrestre (despreciable < 1 km) ni dispersión por
vegetación (ITU-R P.833, opcional a futuro).
"""

from __future__ import annotations
import math
import cmath
from dataclasses import dataclass, field, replace

C = 299_792_458.0  # m/s


# --------------------------------------------------------------------------
# Constantes y geometría básica
# --------------------------------------------------------------------------
def wavelength(f_hz: float = 2.45e9) -> float:
    """Longitud de onda. A 2.45 GHz ~ 0.1224 m."""
    return C / f_hz


def fspl_db(d_m: float, f_hz: float = 2.45e9) -> float:
    """Pérdida en espacio libre [dB]. ~80.2 dB a 100 m / 2.45 GHz."""
    d_m = max(d_m, 1e-3)
    return 20 * math.log10(d_m) + 20 * math.log10(f_hz) - 147.55


def breakpoint_distance(h_t: float, h_r: float, f_hz: float = 2.45e9) -> float:
    """
    Distancia de transición del modelo de dos rayos [m].
    Por debajo: ~20 dB/dec; por encima: ~40 dB/dec.
    Con h=1.5 m a 2.45 GHz da ~73 m -> el orden donde caen los saltos largos.
    """
    return 4 * h_t * h_r / wavelength(f_hz)


def fresnel_radius(d1_m: float, d2_m: float, f_hz: float = 2.45e9, n: int = 1) -> float:
    """Radio de la n-ésima zona de Fresnel [m] en el punto (d1, d2)."""
    lam = wavelength(f_hz)
    return math.sqrt(n * lam * d1_m * d2_m / (d1_m + d2_m))


# --------------------------------------------------------------------------
# Rebote en el suelo: modelo de dos rayos
# --------------------------------------------------------------------------
def reflection_coefficient(theta_graze: float, eps_r: float, sigma: float,
                           f_hz: float, pol: str = "v") -> complex:
    """
    Coeficiente de reflexión de Fresnel para incidencia rasante.
    theta_graze: ángulo de incidencia rasante [rad] (0 = horizonte).
    eps_r, sigma: permitividad relativa y conductividad [S/m] del suelo.
    pol: 'v' (vertical) o 'h' (horizontal).

    eps_r = math.inf -> CONDUCTOR PERFECTO: Gamma = +1, sin dependencia del
    ángulo. Es el caso de referencia (cota superior del rebote) que ofrece el
    visor junto a la tierra real; tenerlo aquí evita que cada página se escriba
    su propio "dos rayos con suelo perfecto".
    """
    if math.isinf(eps_r):
        return complex(1.0, 0.0)
    lam = wavelength(f_hz)
    eps = complex(eps_r, -60.0 * lam * sigma)  # permitividad compleja
    s = math.sin(theta_graze)
    root = cmath.sqrt(eps - math.cos(theta_graze) ** 2)
    if pol.lower().startswith("v"):
        return (eps * s - root) / (eps * s + root)
    return (s - root) / (s + root)


def two_ray_pl_db(d_m: float, h_t: float, h_r: float, f_hz: float = 2.45e9,
                  eps_r: float = 15.0, sigma: float = 5e-3, pol: str = "v") -> float:
    """
    Pérdida de trayecto [dB] sumando rayo directo + reflejado en el suelo.
    d_m: distancia HORIZONTAL Tx-Rx. h_t, h_r: alturas de antena sobre el suelo.
    Reproduce los nulos de interferencia y la pendiente d^4 lejana.
    """
    d_m = max(d_m, 1e-3)
    lam = wavelength(f_hz)
    d_los = math.hypot(d_m, h_t - h_r)
    d_ref = math.hypot(d_m, h_t + h_r)
    theta = math.atan2(h_t + h_r, d_m)          # ángulo rasante del reflejado
    gamma = reflection_coefficient(theta, eps_r, sigma, f_hz, pol)
    dphi = 2 * math.pi * (d_ref - d_los) / lam  # desfase de camino
    field = (1.0 / d_los) + gamma * cmath.exp(-1j * dphi) / d_ref
    return -20 * math.log10((lam / (4 * math.pi)) * abs(field))


# --------------------------------------------------------------------------
# Apantallamiento + topografía: difracción multiobstáculo (Deygout)
# --------------------------------------------------------------------------
def knife_edge_loss_db(v: float) -> float:
    """Pérdida por difracción de filo de cuchillo (ITU-R P.526). v: parámetro de Fresnel."""
    if v <= -0.78:
        return 0.0
    return 6.9 + 20 * math.log10(math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)


def _v_param(h_clear: float, d1: float, d2: float, f_hz: float) -> float:
    """h_clear: altura del obstáculo SOBRE la línea de visión (+ encima)."""
    lam = wavelength(f_hz)
    return h_clear * math.sqrt(2 * (d1 + d2) / (lam * d1 * d2))


def diffraction_loss_db(D_m: float, tx_elev: float, rx_elev: float,
                        obstacles: list[tuple[float, float]],
                        f_hz: float = 2.45e9, depth: int = 0, max_depth: int = 3) -> float:
    """
    Pérdida por difracción [dB] sobre terreno + filas de módulos (método Deygout).
    D_m: distancia horizontal. tx_elev/rx_elev: cotas absolutas de las antenas.
    obstacles: lista de (x_horizontal, cota_superior_absoluta).
    """
    if not obstacles or depth >= max_depth or D_m <= 0:
        return 0.0
    best_v, best_i = -1e9, -1
    for i, (x, top) in enumerate(obstacles):
        if x <= 0 or x >= D_m:
            continue
        los = tx_elev + (rx_elev - tx_elev) * (x / D_m)
        v = _v_param(top - los, x, D_m - x, f_hz)
        if v > best_v:
            best_v, best_i = v, i
    if best_i < 0 or best_v <= -0.78:
        return 0.0
    x0, top0 = obstacles[best_i]
    loss = knife_edge_loss_db(best_v)
    left = [(x, t) for (x, t) in obstacles if x < x0]
    right = [(x - x0, t) for (x, t) in obstacles if x > x0]
    loss += diffraction_loss_db(x0, tx_elev, top0, left, f_hz, depth + 1, max_depth)
    loss += diffraction_loss_db(D_m - x0, top0, rx_elev,
                                [(x, t) for (x, t) in right], f_hz, depth + 1, max_depth)
    return loss


def row_top_elev(ground: float, axis_height: float, panel_chord: float, tilt_deg: float) -> float:
    """
    Cota del borde superior del módulo de un seguidor 1V/1H.
    El borde alto sube (chord/2)*sin(tilt) sobre el eje del tubo.
    panel_chord: ancho del panel a lo largo de la inclinación [m].
    """
    return ground + axis_height + (panel_chord / 2.0) * math.sin(math.radians(abs(tilt_deg)))


# --------------------------------------------------------------------------
# La MESA como obstáculo
# --------------------------------------------------------------------------
# Una fila de seguidores no es un muro desde el suelo: es una PLACA inclinada
# que ocupa una banda de altura [bot, top] sobre una huella de ±hw alrededor del
# eje de su fila. Al inclinarse, su borde bajo BAJA y su cresta SUBE, así que un
# rayo rasante puede pasar por DEBAJO limpio — que es lo que hace el salto
# TCU<->TCU con la antena a la cota de catálogo, y lo que NO hace el salto
# TCU->NCU, que sube a la cabeza de un poste de 2,95 m y cruza la banda de todas
# las filas intermedias.
#
# La regla de despeje es la de `terreno.html` (Cobertura 3D, `linkClearance`),
# contrastada contra la malla MEDIDA de El Burgo: tratar el campo como un muro
# omnidireccional dejaba el 95 % de la planta aislada, contra los 52 enlaces
# vivos que hay. El encadenado entre filas es el Deygout de siempre (P.526).
@dataclass
class TableBand:
    """Banda que ocupa una mesa. Cotas absolutas; `x` = distancia al Tx."""
    x: float
    bot: float
    top: float
    ground: float = 0.0
    hw: float = 0.0


def table_band(x: float, ground: float, axis_h: float, chord: float,
               tilt_deg: float, off: float = 0.0) -> TableBand:
    a = math.radians(abs(tilt_deg))
    c = ground + axis_h + off * math.cos(a)
    h = (chord / 2.0) * math.sin(a)
    return TableBand(x=x, bot=c - h, top=c + h, ground=ground,
                     hw=(chord / 2.0) * math.cos(a))


def band_clearance(los: float, b: TableBand) -> float:
    """+ libre, − tapado. Por debajo del borde bajo limita el suelo o la placa."""
    if los >= b.top:
        return los - b.top
    if los <= b.bot:
        return min(los - b.ground, b.bot - los)
    return -min(los - b.bot, b.top - los)


def band_edge(los: float, b: TableBand) -> float:
    """Borde por el que difracta: el que roza el rayo."""
    if los >= b.top:
        return b.top
    if los <= b.bot:
        return b.bot
    return b.bot if (los - b.bot) < (b.top - los) else b.top


def diffraction_loss_tables_db(D_m: float, tx_elev: float, rx_elev: float,
                               tables: list[TableBand], f_hz: float = 2.45e9,
                               depth: int = 0, max_depth: int = 3) -> float:
    """Deygout sobre mesas (placas), no sobre cimas. Con UNA mesa a mitad de vano
    reproduce el cálculo de una sola fila intermedia."""
    if not tables or depth >= max_depth or D_m <= 0:
        return 0.0
    best_v, best_i = -1e9, -1
    for i, t in enumerate(tables):
        if t.x <= 0 or t.x >= D_m:
            continue
        los = tx_elev + (rx_elev - tx_elev) * (t.x / D_m)
        v = _v_param(-band_clearance(los, t), t.x, D_m - t.x, f_hz)
        if v > best_v:
            best_v, best_i = v, i
    if best_i < 0 or best_v <= -0.78:
        return 0.0
    t0 = tables[best_i]
    los0 = tx_elev + (rx_elev - tx_elev) * (t0.x / D_m)
    edge = band_edge(los0, t0)
    loss = knife_edge_loss_db(best_v)
    left = [t for t in tables if t.x < t0.x]
    right = [replace(t, x=t.x - t0.x) for t in tables if t.x > t0.x]
    loss += diffraction_loss_tables_db(t0.x, tx_elev, edge, left, f_hz, depth + 1, max_depth)
    loss += diffraction_loss_tables_db(D_m - t0.x, edge, rx_elev, right, f_hz, depth + 1, max_depth)
    return loss


# --------------------------------------------------------------------------
# Cotas de antena de catálogo (m sobre el suelo)
# --------------------------------------------------------------------------
# Fuente única para que el visor, el diagnóstico y el siting hablen de los
# mismos equipos. Las tres, tal como las dibuja `terreno.html` en Cobertura 3D:
#   TCU — cuelga de la viga, así que su cota depende de la altura del tubo: se
#         da la CAÍDA bajo el eje (0,225 hasta el conector + 0,50 de coax).
#   NCU — látigo en la CABEZA del poste C 100×60 de 2,95 m del que cuelga el
#         armario 415×515×230 (plano DR_NCU_v0 / «Montaje NCU»).
#   HSU — 2 látigos en la cabeza de la torre de celosía autoportante de 8 m
#         (plano FTR.24.00145_5_C, «Montaje HSU»).
ANTENNAS = {
    "tcu": {"drop_below_tube": 0.725},
    "ncu": {"mast_h": 2.95, "h": 3.15,
            "cab_w": 0.415, "cab_h": 0.515, "cab_d": 0.230, "cab_y": 1.15},
    "hsu": {"tower_h": 8.0, "h": 8.33, "leg_r": 0.15},
}


# --------------------------------------------------------------------------
# Balance de enlace
# --------------------------------------------------------------------------
@dataclass
class LinkParams:
    f_hz: float = 2.45e9
    ptx_dbm: float = 19.0      # XBee-PRO RR. Estándar = +8 dBm. Canal 26: máx +3 dBm (ambas)
    gtx_dbi: float = 3.0       # antena Jinchang JCW435700RA (3 dBi, dipolo ~lambda/2)
    grx_dbi: float = 3.0
    rx_sens_dbm: float = -103.0  # XBee RR Zigbee, modo normal (1% PER)
    sigma_db: float = 6.0        # desvanecimiento log-normal (calibrar con datos)
    eps_r: float = 15.0
    sigma_ground: float = 5e-3
    pol: str = "v"
    l_mod_db: float = 0.0        # penetración extra si el LOS cruza un panel (calibrar)


def _phi(x: float) -> float:
    """CDF normal estándar."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def predict_link(tx: dict, rx: dict, p: LinkParams = LinkParams(),
                 terrain: list[tuple[float, float]] | None = None,
                 obstacles: list[tuple[float, float]] | None = None,
                 tables: list[TableBand] | None = None) -> dict:
    """
    Predice un enlace Tx->Rx.
    tx, rx: dicts con {x, y, ground, h}.  terrain/obstacles: puntos (x, cota).
    tables: mesas (placas entre bot y top), ver diffraction_loss_tables_db.
    Devuelve RSSI predicho, margen, prob. de enlace y desglose de pérdidas.
    """
    d = math.hypot(rx["x"] - tx["x"], rx["y"] - tx["y"])
    pl_2ray = two_ray_pl_db(d, tx["h"], rx["h"], p.f_hz, p.eps_r, p.sigma_ground, p.pol)

    tx_elev = tx["ground"] + tx["h"]
    rx_elev = rx["ground"] + rx["h"]
    pl_diff = 0.0
    pts = list(terrain or []) + list(obstacles or [])
    if pts:
        pl_diff = diffraction_loss_db(d, tx_elev, rx_elev, pts, p.f_hz)
    if tables:
        pl_diff += diffraction_loss_tables_db(d, tx_elev, rx_elev, tables, p.f_hz)

    pl_total = pl_2ray + pl_diff + p.l_mod_db
    prx = p.ptx_dbm + p.gtx_dbi + p.grx_dbi - pl_total
    margin = prx - p.rx_sens_dbm
    return {
        "distance_m": round(d, 2),
        "prx_dbm": round(prx, 2),
        "margin_db": round(margin, 2),
        "p_link": round(_phi(margin / p.sigma_db), 4),
        "pl_2ray_db": round(pl_2ray, 2),
        "pl_diff_db": round(pl_diff, 2),
    }


# --------------------------------------------------------------------------
# Capa de malla y resiliencia (diagnóstico / SPOF)
# --------------------------------------------------------------------------
def build_mesh_graph(nodes: dict, p: LinkParams = LinkParams(),
                     min_margin_db: float = 8.0,
                     obstacle_fn=None, terrain_fn=None):
    """
    Construye el grafo de malla predicho con NetworkX.
    nodes: {id: {x, y, ground, h}}.  Arista si margin >= min_margin_db.
    obstacle_fn(a, b) -> [(x, cota)] y terrain_fn(a, b) -> [(x, cota)] opcionales.
    """
    import networkx as nx
    G = nx.Graph()
    for nid, nd in nodes.items():
        G.add_node(nid, **nd)
    ids = list(nodes)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            obs = obstacle_fn(a, b) if obstacle_fn else None
            ter = terrain_fn(a, b) if terrain_fn else None
            r = predict_link(nodes[a], nodes[b], p, terrain=ter, obstacles=obs)
            if r["margin_db"] >= min_margin_db:
                G.add_edge(a, b, margin_db=r["margin_db"],
                           distance_m=r["distance_m"], p_link=r["p_link"])
    return G


def analyze_resilience(G, gateway) -> dict:
    """
    Diagnóstico de la malla:
      - articulation_points: nodos cuya caída desconecta la red (SPOF).
      - routes_through: nodos por los que pasan más rutas hacia el gateway
        (el dominador de una cadena en margarita salta aquí, p.ej. TCU_062).
    """
    import networkx as nx
    arts = sorted(nx.articulation_points(G)) if G.number_of_nodes() else []
    routes_through = {n: 0 for n in G.nodes()}
    if gateway in G:
        try:
            paths = nx.single_source_shortest_path(G, gateway)
            for dest, path in paths.items():
                for hop in path[1:-1]:  # intermedios, sin extremos
                    routes_through[hop] += 1
        except nx.NetworkXError:
            pass
    top = sorted(routes_through.items(), key=lambda kv: -kv[1])[:5]
    return {"articulation_points": arts, "routes_through_top": top}


# --------------------------------------------------------------------------
# Calibración contra RSSI medido
# --------------------------------------------------------------------------
def calibrate_bias(pred_dbm: list[float], meas_dbm: list[float]) -> dict:
    """
    Ajuste mínimo: sesgo global y sigma del residuo a partir de pares
    (RSSI predicho, RSSI medido). El ajuste fino (n_eff por entorno,
    L_mod por material) llega con el dataset completo de El Burgo I.
    """
    n = len(pred_dbm)
    if n == 0 or n != len(meas_dbm):
        raise ValueError("Listas vacías o de distinta longitud.")
    res = [m - q for q, m in zip(pred_dbm, meas_dbm)]
    bias = sum(res) / n
    var = sum((r - bias) ** 2 for r in res) / n
    return {"bias_db": round(bias, 2), "sigma_db": round(math.sqrt(var), 2), "n": n}


# --------------------------------------------------------------------------
# Demostración autocontenida (geometría sintética)
# --------------------------------------------------------------------------
if __name__ == "__main__":
    p = LinkParams()
    print(f"lambda = {wavelength()*100:.2f} cm")
    print(f"FSPL @100 m = {fspl_db(100):.2f} dB")
    print(f"d_break (h=1.5 m) = {breakpoint_distance(1.5, 1.5):.1f} m")
    print(f"r1 Fresnel @100 m (centro) = {fresnel_radius(50, 50):.2f} m\n")

    # Enlace despejado a 60 m y a 180 m (cruza el breakpoint)
    tx = {"x": 0, "y": 0, "ground": 0.0, "h": 1.5}
    for dist in (60, 180):
        rx = {"x": dist, "y": 0, "ground": 0.0, "h": 1.5}
        r = predict_link(tx, rx, p)
        print(f"  {dist:>3} m  RSSI={r['prx_dbm']:>7} dBm  margen={r['margin_db']:>6} dB  P={r['p_link']}")

    # Enlace con una fila de seguidores a tope de inclinación bloqueando
    rx = {"x": 120, "y": 0, "ground": 0.0, "h": 1.5}
    blocked = predict_link(tx, rx, p, obstacles=[(60, row_top_elev(0.2, 1.5, 4.0, 60))])
    print(f"\n  120 m con fila a 60° -> margen={blocked['margin_db']} dB "
          f"(difracción {blocked['pl_diff_db']} dB)")

    # Malla sintética: cada salto cruza las filas intermedias a 60 deg.
    # Los enlaces largos acumulan difracción y caen -> cadena en margarita.
    nodes = {f"TCU_{i:02d}": {"x": i * 70, "y": 0.0, "ground": 0.0, "h": 1.5}
             for i in range(8)}

    def rows_between(a, b):
        ia, ib = int(a[-2:]), int(b[-2:])
        lo, hi = sorted((ia, ib))
        return [(nodes[f"TCU_{k:02d}"]["x"] - lo * 70, row_top_elev(0.2, 1.5, 4.0, 60))
                for k in range(lo + 1, hi)]

    G = build_mesh_graph(nodes, p, min_margin_db=30.0, obstacle_fn=rows_between)
    diag = analyze_resilience(G, gateway="TCU_00")
    print(f"\n  Aristas predichas: {G.number_of_edges()}")
    print(f"  SPOF (puntos de articulación): {diag['articulation_points']}")
    print(f"  Rutas que pasan por cada nodo: {diag['routes_through_top']}")
