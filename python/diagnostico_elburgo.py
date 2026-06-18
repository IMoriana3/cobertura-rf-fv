"""
diagnostico_elburgo.py
======================
Puente entre tus datos de El Burgo I y el núcleo zigbee_pv_model.

Flujo:
  coordenadas + RSSI medido
    -> calibra (sesgo y sigma reales contra lo medido)
    -> construye la malla predicha (NetworkX)
    -> analiza resiliencia (SPOF, dominador de rutas)
    -> exporta GeoJSON para el visor Leaflet ("máquina del tiempo")

El GeoJSON lleva nodos (con flag de SPOF y rutas que pasan por cada uno)
y aristas (con margen predicho, RSSI medido y probabilidad de enlace),
listo para un sexto modo de coloreado "predicho/SPOF".

Uso:
  python3 diagnostico_elburgo.py coords.csv rssi.csv salida.geojson
  python3 diagnostico_elburgo.py            # demo sintética autocontenida

CSV de coordenadas (cabecera flexible, se auto-detecta):
  id, x, y [, cota]        en UTM/metros locales
  id, lon, lat [, cota]    en geográficas
CSV de RSSI medido:
  origen, destino, rssi_dbm
"""

from __future__ import annotations
import csv
import json
import sys
import math
from zigbee_pv_model import (
    LinkParams, predict_link, two_ray_pl_db, build_mesh_graph,
    analyze_resilience, calibrate_bias, fspl_db,
)

# Alias de columnas aceptados (en minúsculas)
COL_ID = {"id", "nodo", "tcu", "name", "nombre"}
COL_X = {"x", "este", "easting", "utm_x"}
COL_Y = {"y", "norte", "northing", "utm_y"}
COL_LON = {"lon", "longitud", "longitude", "lng"}
COL_LAT = {"lat", "latitud", "latitude"}
COL_GROUND = {"cota", "ground", "z", "elev", "elevacion", "altitud"}
COL_SRC = {"origen", "src", "source", "from", "desde", "a"}
COL_DST = {"destino", "dst", "dest", "to", "hacia", "b"}
COL_RSSI = {"rssi", "rssi_dbm", "dbm", "nivel"}

DEFAULT_ANTENNA_H = 1.5  # altura de antena sobre el suelo [m] (caja SUNNER)


def _pick(header: list[str], names: set[str]) -> int | None:
    for i, h in enumerate(header):
        if h.strip().lower() in names:
            return i
    return None


def load_nodes(path: str, antenna_h: float = DEFAULT_ANTENNA_H) -> tuple[dict, bool]:
    """Carga nodos. Devuelve (nodes, es_geografico)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]
    i_id = _pick(header, COL_ID)
    i_x, i_y = _pick(header, COL_X), _pick(header, COL_Y)
    i_lon, i_lat = _pick(header, COL_LON), _pick(header, COL_LAT)
    i_g = _pick(header, COL_GROUND)
    geo = i_lon is not None and i_lat is not None
    nodes = {}
    for r in data:
        if not r or i_id is None:
            continue
        nid = r[i_id].strip()
        if geo:
            lon, lat = float(r[i_lon]), float(r[i_lat])
            # proyección local plana para distancias (suficiente a escala de planta)
            x = lon * 111320.0 * math.cos(math.radians(lat))
            y = lat * 110540.0
            nodes[nid] = {"x": x, "y": y, "lon": lon, "lat": lat,
                          "ground": float(r[i_g]) if i_g is not None else 0.0,
                          "h": antenna_h}
        else:
            nodes[nid] = {"x": float(r[i_x]), "y": float(r[i_y]),
                          "ground": float(r[i_g]) if i_g is not None else 0.0,
                          "h": antenna_h}
    return nodes, geo


def load_measurements(path: str) -> list[tuple[str, str, float]]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]
    i_s, i_d, i_r = _pick(header, COL_SRC), _pick(header, COL_DST), _pick(header, COL_RSSI)
    out = []
    for r in data:
        if r and i_s is not None and i_d is not None and i_r is not None:
            out.append((r[i_s].strip(), r[i_d].strip(), float(r[i_r])))
    return out


def calibrate(nodes: dict, meas: list, p: LinkParams) -> dict:
    """Ajusta sesgo y sigma comparando RSSI predicho vs medido en los enlaces medidos."""
    pred, real = [], []
    for s, d, rssi in meas:
        if s in nodes and d in nodes:
            q = predict_link(nodes[s], nodes[d], p)["prx_dbm"]
            pred.append(q)
            real.append(rssi)
    if not pred:
        return {"bias_db": 0.0, "sigma_db": p.sigma_db, "n": 0}
    return calibrate_bias(pred, real)


def to_geojson(nodes, G, diag, geo: bool, meas_lookup: dict, bias: float) -> dict:
    spof = set(diag["articulation_points"])
    rt = dict(diag["routes_through_top"])
    feats = []
    for nid, nd in nodes.items():
        lon = nd.get("lon", nd["x"])
        lat = nd.get("lat", nd["y"])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"id": nid, "is_spof": nid in spof,
                           "routes_through": rt.get(nid, 0),
                           "degree": G.degree(nid) if nid in G else 0},
        })
    for a, b, ed in G.edges(data=True):
        la = nodes[a].get("lon", nodes[a]["x"]); aa = nodes[a].get("lat", nodes[a]["y"])
        lb = nodes[b].get("lon", nodes[b]["x"]); ab = nodes[b].get("lat", nodes[b]["y"])
        rssi_meas = meas_lookup.get((a, b)) or meas_lookup.get((b, a))
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[la, aa], [lb, ab]]},
            "properties": {"margin_db": ed["margin_db"], "p_link": ed["p_link"],
                           "distance_m": ed["distance_m"], "rssi_medido_dbm": rssi_meas},
        })
    crs = "EPSG:4326" if geo else "local-meters"
    return {"type": "FeatureCollection", "crs_note": crs, "calibracion_bias_db": bias,
            "features": feats}


def run(coords_csv=None, rssi_csv=None, out_path="diagnostico_elburgo.geojson",
        gateway=None, min_margin_db=8.0, p: LinkParams = None):
    p = p or LinkParams()

    if coords_csv:
        nodes, geo = load_nodes(coords_csv)
        meas = load_measurements(rssi_csv) if rssi_csv else []
    else:
        nodes, geo, meas = _synthetic()

    cal = calibrate(nodes, meas, p)
    bias = cal["bias_db"]
    # Aplica la calibración: el sesgo se traslada a la potencia efectiva, sigma al margen
    pc = LinkParams(**{**p.__dict__})
    pc.ptx_dbm = p.ptx_dbm + bias
    if cal["n"] >= 3:
        pc.sigma_db = cal["sigma_db"]

    G = build_mesh_graph(nodes, pc, min_margin_db=min_margin_db)
    gw = gateway or next(iter(nodes))
    diag = analyze_resilience(G, gateway=gw)

    meas_lookup = {(s, d): r for s, d, r in meas}
    gj = to_geojson(nodes, G, diag, geo, meas_lookup, bias)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False, indent=2)

    print(f"Nodos: {len(nodes)}  |  Medidas usadas para calibrar: {cal['n']}")
    print(f"Calibración -> sesgo {bias:+.2f} dB, sigma {pc.sigma_db:.2f} dB")
    print(f"Aristas predichas (margen>={min_margin_db} dB): {G.number_of_edges()}")
    print(f"SPOF (puntos de articulación): {diag['articulation_points'] or '—'}")
    print(f"Dominadores (rutas que pasan por el nodo): {diag['routes_through_top'][:3]}")
    print(f"GeoJSON escrito en: {out_path}")
    return gj


def _synthetic():
    """Planta de juguete en cadena con RSSI 'medido' = modelo + sesgo + ruido."""
    import random
    random.seed(7)
    nodes = {f"TCU_{i:02d}": {"x": i * 70.0, "y": 0.0, "ground": 0.0, "h": 1.5}
             for i in range(8)}
    p = LinkParams()
    meas = []
    for i in range(7):  # enlaces reales = saltos contiguos
        a, b = f"TCU_{i:02d}", f"TCU_{i+1:02d}"
        q = predict_link(nodes[a], nodes[b], p)["prx_dbm"]
        meas.append((a, b, round(q - 4.0 + random.gauss(0, 2), 1)))  # sesgo -4 dB + ruido
    return nodes, False, meas


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2:
        out = args[2] if len(args) >= 3 else "diagnostico_elburgo.geojson"
        run(args[0], args[1], out)
    else:
        run()  # demo sintética
