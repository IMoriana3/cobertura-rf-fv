"""
adaptador_elburgo.py
====================
Convierte los datos reales de El Burgo I (NCU1) en material para el modelo:

  - Topología OBSERVADA de la malla (padres reales, dominadores, SPOF).
  - Dataset de RSSI por ENLACE (padre->hijo) para calibrar zigbee_pv_model.
  - Informe de calibración (sesgo, sigma, n_eff efectivo) modelo vs medido.
  - GeoJSON para el visor Leaflet (nodos con SPOF/rutas, aristas con RSSI).

El RSSI del log es por NODO; aquí se atribuye al enlace con su PADRE (penúltimo
nodo de su ruta en zigbee_routes). Antes de fiarse, se comprueba que el RSSI
correlaciona con la distancia del ÚLTIMO salto (no con el nº total de saltos).

Entradas:
  coords_ElBurgo_NCU1.csv   node_id, lat, lon, etiqueta
  zigbee_routes.csv         timestamp, target, hop_count, path_ids, path_addrs
  zigbee_log.csv            timestamp, ..., node_id, role, ..., rssi_dbm, ack_failures, ...

Uso:
  python3 adaptador_elburgo.py coords.csv routes.csv log.csv [prefijo_salida]
"""

from __future__ import annotations
import csv, json, sys, math, statistics
from collections import Counter, defaultdict
from zigbee_pv_model import LinkParams, predict_link, two_ray_pl_db, fspl_db

ROOT = "COORD"
PARENT_EDGE_MIN_FRAC = 0.05   # un padre cuenta como enlace si se usa >=5% del tiempo del nodo
ANTENNA_H = 1.5


# ---------------------------------------------------------------- utilidades
def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return float("nan")
    mx, my = sum(xs)/n, sum(ys)/n
    sxy = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    sxx = sum((x-mx)**2 for x in xs); syy = sum((y-my)**2 for y in ys)
    if sxx == 0 or syy == 0: return float("nan")
    return sxy / math.sqrt(sxx*syy)

def linfit(xs, ys):
    """Mínimos cuadrados y = a + b*x. Devuelve (a, b)."""
    n = len(xs); mx, my = sum(xs)/n, sum(ys)/n
    sxx = sum((x-mx)**2 for x in xs)
    sxy = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    b = sxy/sxx if sxx else 0.0
    return my - b*mx, b


# ---------------------------------------------------------------- carga
def load_coords(path):
    nodes = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            nodes[r["node_id"].strip()] = {
                "lat": float(r["lat"]), "lon": float(r["lon"]),
                "etiqueta": r.get("etiqueta", "").strip(), "h": ANTENNA_H, "ground": 0.0,
            }
    return nodes


def stream_routes(path):
    """Recorre las rutas: frecuencia de aristas, padres por nodo, hops por nodo."""
    edge_freq = Counter()                  # (padre, hijo) -> nº de apariciones
    parent_count = defaultdict(Counter)    # hijo -> Counter de padres
    node_routes = Counter()                # nº de rutas en que aparece cada destino
    hops = defaultdict(list)               # destino -> lista de hop_count
    n_rows = 0
    ts = set()
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            chain = [c.strip() for c in r["path_ids"].split(">") if c.strip()]
            if len(chain) < 2:
                continue
            n_rows += 1
            ts.add(r["timestamp"])
            target = chain[-1]
            node_routes[target] += 1
            try: hops[target].append(int(r["hop_count"]))
            except ValueError: pass
            for a, b in zip(chain[:-1], chain[1:]):
                edge_freq[(a, b)] += 1
                parent_count[b][a] += 1
    return edge_freq, parent_count, node_routes, hops, n_rows, len(ts)


def stream_log(path):
    rssi = defaultdict(list); ack = defaultdict(int); seen = defaultdict(int); role = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            nid = r["node_id"].strip()
            role[nid] = r.get("role", "").strip()
            try: rssi[nid].append(int(r["rssi_dbm"]))
            except (ValueError, KeyError): pass
            try: ack[nid] += int(r["ack_failures"])
            except (ValueError, KeyError): pass
            seen[nid] += 1
    return rssi, ack, seen, role


# ---------------------------------------------------------------- análisis
def descendant_counts(dom_parent):
    """Tamaño del subárbol (descendientes) de cada nodo en el árbol de padres dominantes."""
    desc = Counter()
    for child in dom_parent:
        cur = dom_parent.get(child)
        guard = 0
        while cur is not None and cur != ROOT and guard < 1000:
            desc[cur] += 1
            cur = dom_parent.get(cur); guard += 1
    return desc


def build_union_graph(parent_count, node_routes):
    import networkx as nx
    G = nx.Graph()
    for child, pcnt in parent_count.items():
        tot = sum(pcnt.values())
        for parent, c in pcnt.items():
            if c / tot >= PARENT_EDGE_MIN_FRAC:
                G.add_edge(parent, child)
    return G


def run(coords_csv, routes_csv, log_csv, prefix="elburgo_real"):
    import networkx as nx
    coords = load_coords(coords_csv)
    edge_freq, parent_count, node_routes, hops, n_rows, n_ts = stream_routes(routes_csv)
    rssi, ack, seen, role = stream_log(log_csv)

    # Padre dominante de cada nodo
    dom_parent = {child: pcnt.most_common(1)[0][0] for child, pcnt in parent_count.items()}

    # --- 1) Comprobación: ¿el RSSI sigue al último salto o a la ruta entera? ---
    rssi_med = {n: statistics.median(v) for n, v in rssi.items() if v}
    d_lasthop, r_lasthop, hop_typ, r_byhop = [], [], [], []
    for n, rmed in rssi_med.items():
        p = dom_parent.get(n)
        if p and p != ROOT and p in coords and n in coords:
            d = haversine_m(coords[n]["lat"], coords[n]["lon"], coords[p]["lat"], coords[p]["lon"])
            d_lasthop.append(d); r_lasthop.append(rmed)
        if hops.get(n):
            hop_typ.append(statistics.median(hops[n])); r_byhop.append(rmed)
    r_dist = pearson(d_lasthop, r_lasthop)
    r_hops = pearson(hop_typ, r_byhop)

    # --- 2) Dataset de RSSI por enlace (padre dominante -> hijo) con distancia ---
    p = LinkParams()  # XBee-PRO RR + antena 3 dBi + -103 dBm
    links = []  # (parent, child, rssi_med, dist, prx_pred)
    for n, rmed in rssi_med.items():
        par = dom_parent.get(n)
        if not par or par == ROOT or par not in coords or n not in coords:
            continue
        d = haversine_m(coords[n]["lat"], coords[n]["lon"], coords[par]["lat"], coords[par]["lon"])
        tx = {"x": 0, "y": 0, "ground": 0.0, "h": ANTENNA_H}
        rx = {"x": d, "y": 0, "ground": 0.0, "h": ANTENNA_H}
        prx_pred = predict_link(tx, rx, p)["prx_dbm"]
        links.append((par, n, rmed, d, prx_pred))

    # --- 3) Calibración: medido vs predicho ---
    res = [m - q for (_, _, m, _, q) in links]
    bias = sum(res)/len(res) if res else 0.0
    sigma = statistics.pstdev(res) if len(res) > 1 else 0.0
    # n_eff: RSSI = a - 10*n*log10(d)
    ds = [math.log10(max(d, 1.0)) for (_, _, _, d, _) in links]
    ms = [m for (_, _, m, _, _) in links]
    a_fit, b_fit = linfit(ds, ms)
    n_eff = -b_fit / 10.0

    # --- 4) SPOF y dominadores ---
    desc = descendant_counts(dom_parent)
    G = build_union_graph(parent_count, node_routes)
    arts = sorted([a for a in nx.articulation_points(G)]) if G.number_of_nodes() else []
    # diversidad de padres (nodos con un único padre = sin redundancia)
    single_parent = [n for n, pc in parent_count.items()
                     if sum(1 for c in pc.values() if c/sum(pc.values()) >= PARENT_EDGE_MIN_FRAC) == 1]

    # --- 5) Salidas ---
    # 5a) rssi por enlace (para diagnostico_elburgo.py)
    rssi_csv = f"{prefix}_rssi.csv"
    with open(rssi_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["origen", "destino", "rssi_dbm"])
        for par, n, rmed, d, q in sorted(links, key=lambda x: x[3]):
            w.writerow([par, n, round(rmed)])

    # 5b) GeoJSON observado
    coord_root = None
    first_hops = [c for (a, c) in edge_freq if a == ROOT]
    if first_hops:
        las = [coords[c]["lat"] for c in first_hops if c in coords]
        los = [coords[c]["lon"] for c in first_hops if c in coords]
        if las: coord_root = (sum(los)/len(los), sum(las)/len(las))  # centroide aprox.

    feats = []
    for n, c in coords.items():
        if n not in rssi_med and n not in dom_parent:
            continue
        feats.append({"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
            "properties": {
                "id": n, "etiqueta": c["etiqueta"], "role": role.get(n, "TCU"),
                "is_spof": n in arts, "descendientes": desc.get(n, 0),
                "rutas": node_routes.get(n, 0),
                "rssi_med_dbm": rssi_med.get(n), "ack_failures": ack.get(n, 0),
                "hop_tipico": round(statistics.median(hops[n])) if hops.get(n) else None,
                "padres_distintos": len(parent_count.get(n, {})),
                "padre_dominante": dom_parent.get(n),
            }})
    if coord_root:
        feats.append({"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [coord_root[0], coord_root[1]]},
            "properties": {"id": ROOT, "role": "COORD", "is_spof": True, "nota": "posicion aprox. (centroide de 1os saltos)"}})
    # aristas dominantes
    edge_med_rssi = {(par, n): rmed for (par, n, rmed, d, q) in links}
    for n, par in dom_parent.items():
        if par not in coords and par != ROOT: continue
        if n not in coords: continue
        a_lat, a_lon = (coord_root[1], coord_root[0]) if par == ROOT and coord_root else \
                       (coords[par]["lat"], coords[par]["lon"]) if par in coords else (None, None)
        if a_lat is None: continue
        d = haversine_m(a_lat, a_lon, coords[n]["lat"], coords[n]["lon"])
        feats.append({"type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[a_lon, a_lat], [coords[n]["lon"], coords[n]["lat"]]]},
            "properties": {"origen": par, "destino": n, "distancia_m": round(d, 1),
                           "rssi_medido_dbm": edge_med_rssi.get((par, n)),
                           "freq": edge_freq.get((par, n), 0)}})
    gj = {"type": "FeatureCollection", "crs_note": "EPSG:4326",
          "periodo_filas_routes": n_rows, "snapshots": n_ts,
          "calibracion": {"bias_db": round(bias, 2), "sigma_db": round(sigma, 2),
                          "n_eff": round(n_eff, 2), "n_enlaces": len(links)},
          "features": feats}
    geojson = f"{prefix}.geojson"
    with open(geojson, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False, indent=2)

    # --- informe ---
    print("="*64)
    print("EL BURGO I (NCU1) — diagnóstico de malla Zigbee")
    print("="*64)
    print(f"Rutas procesadas: {n_rows:,}  |  snapshots: {n_ts:,}  |  nodos con coords: {len(coords)}")
    print(f"Nodos con RSSI en log: {len(rssi_med)}  |  enlaces con distancia: {len(links)}")
    print()
    print("-- 1) ¿El RSSI es del enlace al padre? --")
    print(f"   corr(RSSI, distancia último salto) = {r_dist:+.2f}   (negativo = sí, más lejos peor)")
    print(f"   corr(RSSI, nº de saltos total)     = {r_hops:+.2f}   (si domina esto -> sería end-to-end)")
    print()
    print("-- 2) Calibración modelo vs medido --")
    print(f"   sesgo global   = {bias:+.1f} dB   (medido - predicho; pérdida real extra del modelo idealizado)")
    print(f"   sigma residuo  = {sigma:.1f} dB")
    print(f"   n_eff ajustado = {n_eff:.2f}   (espacio libre = 2.0; >2 = más pérdida con la distancia)")
    print()
    print("-- 3) Topología y puntos críticos --")
    top_desc = sorted(desc.items(), key=lambda kv: -kv[1])[:6]
    print(f"   Dominadores (más descendientes): {top_desc}")
    print(f"   SPOF (puntos de articulación, grafo con redundancia): {arts or '—'}")
    print(f"   Nodos sin padre alternativo (sin redundancia): {len(single_parent)} de {len(parent_count)}")
    print(f"   Profundidad máxima de cadena: {max((max(h) for h in hops.values() if h), default=0)} saltos")
    print()
    print("-- 4) Enlaces más débiles (RSSI mediano) --")
    for par, n, rmed, d, q in sorted(links, key=lambda x: x[2])[:6]:
        print(f"   {par} -> {n}:  {rmed:.0f} dBm  @ {d:.0f} m  (predicho {q:.0f} dBm)")
    print()
    print(f"Escrito: {rssi_csv}  y  {geojson}")
    return gj


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 3:
        print("Uso: python3 adaptador_elburgo.py coords.csv routes.csv log.csv [prefijo]")
        sys.exit(1)
    run(a[0], a[1], a[2], a[3] if len(a) >= 4 else "elburgo_real")
