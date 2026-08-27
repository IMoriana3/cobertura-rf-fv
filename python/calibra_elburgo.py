#!/usr/bin/env python3
"""
calibra_elburgo.py — QUÉ dicen, y qué NO dicen, las medidas de El Burgo I
=========================================================================
El núcleo trae una calibración con nombre y apellidos (`EL_BURGO_BIAS_DB`) y el
simulador la ofrece como modelo del enlace. Un número así no puede vivir en una
constante sin que se pueda volver a sacar del dato: esto lo saca, con los CSV que
van en el repo, y de paso mide hasta dónde llega.

    python3 python/calibra_elburgo.py

LO QUE SALE, y es lo que hay que mirar antes de usar el número:

  · el par (−33,6 dB, σ 6,8) que estaba escrito en el núcleo NO se reproduce con
    ninguna configuración razonable. La documentada da −24,6 con σ 8,6;
  · el residuo de un ajuste de un solo número barre unos 43 dB con la distancia:
    lo que falla no es el offset, es que el modelo decae mucho más deprisa que la
    realidad;
  · y la razón es el DATO: sobre enlaces de 24 a 339 m —un rango de ×14, donde el
    espacio libre solo ya predice 23 dB de caída— el RSSI medido correlaciona
    r ≈ +0,16 con log(distancia). O sea, NO DEPENDE DE LA DISTANCIA.

Eso es lo que se espera de una muestra CENSURADA: la malla enruta por los
enlaces que funcionan, así que lo medido son los buenos, no una muestra del
espacio. Un sesgo ajustado contra eso recentra el modelo sobre la media de los
enlaces supervivientes; no lo contrasta.

CONCLUSIÓN. Estas medidas sirven para acotar el nivel típico de un enlace que la
malla usa, y no sirven para calibrar el nivel absoluto ni la caída con la
distancia. Para eso hacen falta medidas de enlaces ELEGIDOS por su geometría
—incluidos los que no llegan—, no las rutas que la red se buscó.
"""
from __future__ import annotations
import csv, math, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "python"))
import zigbee_pv_model as m                                    # noqa: E402

RSSI_CSV = os.path.join(RAIZ, "elburgo_real_rssi.csv")
COORD_CSV = os.path.join(RAIZ, "plantas", "elburgo_coords.csv")
HTUBE, DROP = 1.5, 0.725          # viga y caída del látigo de la TCU (catálogo)


def carga():
    """Nodos en metros locales y los pares medidos."""
    filas = list(csv.DictReader(open(COORD_CSV, encoding="utf-8")))
    lat0 = sum(float(f["lat"]) for f in filas) / len(filas)
    lon0 = sum(float(f["lon"]) for f in filas) / len(filas)
    kx = 111320.0 * math.cos(math.radians(lat0))
    nodos = {f["node_id"]: (( float(f["lon"]) - lon0) * kx,
                            ( float(f["lat"]) - lat0) * 110540.0) for f in filas}
    pares = [(r["origen"], r["destino"], float(r["rssi_dbm"]))
             for r in csv.DictReader(open(RSSI_CSV, encoding="utf-8"))]
    return nodos, [(a, b, r) for a, b, r in pares if a in nodos and b in nodos]


def distancias(nodos, pares):
    return [math.dist(nodos[a], nodos[b]) for a, b, _ in pares]


def ajusta(nodos, pares, h_ant, p):
    """Sesgo y sigma de un ajuste de UN parámetro, con el modelo desnudo."""
    pred, real = [], []
    for a, b, r in pares:
        d = math.dist(nodos[a], nodos[b])
        q = m.predict_link({"x": 0, "y": 0, "ground": 0, "h": h_ant},
                           {"x": d, "y": 0, "ground": 0, "h": h_ant}, p)
        pred.append(q["prx_dbm"]); real.append(r)
    return m.calibrate_bias(pred, real)


def pendiente(xs, ys):
    """Recta por mínimos cuadrados: devuelve (pendiente, corte, r)."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / sxx, my - (sxy / sxx) * mx, sxy / math.sqrt(sxx * syy)


def main() -> int:
    nodos, pares = carga()
    D = distancias(nodos, pares)
    R = [r for _, _, r in pares]
    print("MEDIDAS  %d enlaces  ·  %.0f–%.0f m (rango ×%.1f)" % (len(pares), min(D), max(D), max(D) / min(D)))
    print("         RSSI de %.0f a %.0f dBm — %.0f dB de rango" % (min(R), max(R), max(R) - min(R)))

    b, _, r = pendiente([math.log10(d) for d in D], R)
    print("\nLO QUE DICE EL DATO, sin modelo por medio:")
    print("  RSSI vs log10(distancia): %+.1f dB/década,  r = %+.3f" % (b, r))
    print("  el espacio libre SOLO, en ese rango, predice %.0f dB de caída" % (-20 * math.log10(max(D) / min(D))))
    print("  -> n_eff = %.2f: el nivel medido NO depende de la distancia." % (-b / 20))

    print("\nAJUSTE DE UN PARÁMETRO (lo que hay en el núcleo):")
    for h, tag in ((1.5, "antena 1,50 m — la del flujo documentado"),
                   (HTUBE - DROP, "antena %.3f m — viga menos caída de catálogo" % (HTUBE - DROP))):
        for eps, suelo in ((15.0, "tierra real"), (float("inf"), "conductor perfecto")):
            c = ajusta(nodos, pares, h, m.LinkParams(eps_r=eps))
            print("  %-44s %-18s sesgo %+7.2f  σ %5.2f" % (tag, suelo, c["bias_db"], c["sigma_db"]))
    print("  el par escrito en el núcleo era (%+.1f, σ %.1f): no sale de aquí." % (m.EL_BURGO_BIAS_DB, 6.8))

    print("\nPOR QUÉ NO BASTA UN NÚMERO — residuo por tramo (ajuste de un parámetro):")
    p = m.LinkParams()
    c = ajusta(nodos, pares, HTUBE - DROP, p)
    for a0, z0 in ((0, 60), (60, 120), (120, 200), (200, 400)):
        g = [(d, rr) for d, rr in zip(D, R) if a0 <= d < z0]
        if not g:
            continue
        res = []
        for d, rr in g:
            q = m.predict_link({"x": 0, "y": 0, "ground": 0, "h": HTUBE - DROP},
                               {"x": d, "y": 0, "ground": 0, "h": HTUBE - DROP}, p)
            res.append(rr - q["prx_dbm"] - c["bias_db"])
        mu = sum(res) / len(res)
        sd = math.sqrt(sum((v - mu) ** 2 for v in res) / len(res))
        print("  %3d–%3d m  n=%2d   residuo medio %+6.1f dB   σ %5.1f" % (a0, z0, len(g), mu, sd))
    print("  el residuo barre decenas de dB con la distancia: sobra offset y falta exponente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
