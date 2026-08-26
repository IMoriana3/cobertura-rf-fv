#!/usr/bin/env python3
"""
El núcleo físico — y la PARIDAD entre sus dos puertos.

`zigbee_pv_model.py` y `web/zigbee_pv_model.js` son el mismo modelo escrito dos
veces. Eso se sostiene mientras alguien lo compruebe: en cuanto una rama toca
uno de los dos, el visor y el diagnóstico empiezan a dar números distintos del
mismo enlace y nadie se entera hasta que hay que defender una cifra delante de
un cliente. Este banco los corre sobre los mismos casos y exige el mismo dB.

Comprueba además lo que hace de la mesa un obstáculo honesto:
  · una fila es una PLACA entre dos cotas, no un muro desde el suelo: un rayo
    por debajo del canto bajo sale limpio, y lo que lo limita es el suelo o la
    propia placa;
  · con UNA mesa a mitad de vano, el Deygout de placas reproduce exactamente el
    cálculo de una sola fila intermedia;
  · subir la antena por encima de la cresta CRUZA las mesas y multiplica la
    difracción — el mecanismo del salto TCU->NCU (no es monótona: dentro del
    régimen "cruzando", el Deygout cambia de fila dominante y da dientes);
  · el suelo perfecto (eps_r = inf) da Gamma = +1.

    python3 tests/test_nucleo.py
"""
import json
import math
import os
import shutil
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "python"))
import zigbee_pv_model as m  # noqa: E402

ok = ko = 0


def check(nombre, cond, extra=None):
    global ok, ko
    if cond:
        ok += 1
        print("OK   " + nombre)
    else:
        ko += 1
        print("FAIL " + nombre + ("" if extra is None else " -> " + str(extra)))


def cerca(a, b, tol=1e-9):
    return abs(a - b) <= tol


# --- geometría de la planta de referencia (la del visor) ---
P, H, CH, OFF, TILT, HA = 6.0, 1.5, 2.382, 0.14, 30.0, 0.78
HNCU = m.ANTENNAS["ncu"]["h"]

# ---------------------------------------------------------------- suelo perfecto
g = m.reflection_coefficient(0.2, math.inf, 5e-3, 2.45e9)
check("suelo perfecto: Gamma = +1", cerca(g.real, 1.0) and cerca(g.imag, 0.0), g)

# ---------------------------------------------------------------- la mesa es una placa
b = m.table_band(P, 0.0, H, CH, TILT, OFF)
a = math.radians(TILT)
check("la banda de la mesa sale de las cotas del seguidor",
      cerca(b.bot, H + OFF * math.cos(a) - (CH / 2) * math.sin(a)) and
      cerca(b.top, H + OFF * math.cos(a) + (CH / 2) * math.sin(a)), (b.bot, b.top))
check("por encima de la cresta: despeje positivo", m.band_clearance(b.top + 0.5, b) > 0)
check("dentro de la banda: despeje NEGATIVO (tapado)", m.band_clearance((b.bot + b.top) / 2, b) < 0)
check("por debajo del canto bajo: limita el suelo o la placa, no la cresta",
      cerca(m.band_clearance(HA, b), min(HA - 0.0, b.bot - HA)), m.band_clearance(HA, b))
check("el borde por el que difracta es el que roza el rayo",
      cerca(m.band_edge(HA, b), b.bot) and cerca(m.band_edge(b.top + 1, b), b.top))

# ------------------------------------------------- una mesa == una fila intermedia
lam = m.wavelength()
v_mano = (HA - b.bot) * math.sqrt(2 * (P + P) / (lam * P * P))
check("con UNA mesa reproduce el cálculo de una fila intermedia",
      cerca(m.diffraction_loss_tables_db(2 * P, HA, HA, [b]), m.knife_edge_loss_db(v_mano), 1e-9),
      m.diffraction_loss_tables_db(2 * P, HA, HA, [b]))

# ------------------------------------------------- el mecanismo del salto a la NCU
def difr_ncu(h_ncu, filas=(2, 3, 4, 5), d_ncu=12.0):
    xa = P
    tabs = [m.table_band(abs(i * P - xa), 0.0, H, CH, TILT, OFF) for i in filas]
    return m.diffraction_loss_tables_db(5 * P + d_ncu - xa, HA, h_ncu, tabs)


# Ojo: no es MONÓTONA. Dentro del régimen "cruzando", el Deygout cambia de fila
# dominante y la pérdida da pequeños dientes (45,1 dB a 2,50 y 43,8 a 3,15). Lo
# robusto —y lo que importa— es el SALTO de régimen: pasar de ir por debajo del
# canto bajo a cruzar la banda multiplica la difracción.
alturas = [1.0, 1.5, 2.0, 2.5, 3.15]
difs = [difr_ncu(h) for h in alturas]
bajo, cresta = difs[0], max(difs[3], difs[4])
check("cruzar la cresta multiplica la difracción del salto a la NCU",
      cresta > 2.5 * bajo,
      " ".join("%.1f@%.2f" % (d, h) for d, h in zip(difs, alturas)))
check("por debajo del canto bajo la difracción es la de rozar, no la de cruzar",
      bajo < 0.5 * cresta, "%.1f vs %.1f" % (bajo, cresta))
check("el salto TCU->TCU (por debajo de las mesas) pierde mucho menos que el TCU->NCU",
      m.diffraction_loss_tables_db(2 * P, HA, HA, [b]) < difs[-1] / 5,
      "%.2f vs %.2f" % (m.diffraction_loss_tables_db(2 * P, HA, HA, [b]), difs[-1]))
check("sin mesas de por medio no hay difracción",
      cerca(m.diffraction_loss_tables_db(20.0, HA, HNCU, []), 0.0))

# ---------------------------------------------------------------- cotas de catálogo
check("cotas de antena de catálogo declaradas (TCU/NCU/HSU)",
      set(m.ANTENNAS) == {"tcu", "ncu", "hsu"} and
      cerca(m.ANTENNAS["ncu"]["h"], 3.15) and cerca(m.ANTENNAS["hsu"]["h"], 8.33),
      m.ANTENNAS)
check("la caída de la TCU es la del modelo del seguidor (0,225 + 0,50)",
      cerca(m.ANTENNAS["tcu"]["drop_below_tube"], 0.725), m.ANTENNAS["tcu"])

# ---------------------------------------------------------------- PARIDAD .py <-> .js
CASOS = [
    # (d, ht, hr, eps_r, filas_intermedias)   filas = x de cada mesa desde el Tx
    (2 * P, HA, HA, math.inf, [P]),
    (2 * P, HA, HA, 15.0, [P]),
    (5 * P + 12 - P, HA, HNCU, math.inf, [P, 2 * P, 3 * P, 4 * P]),
    (5 * P + 12 - P, HA, HNCU, 15.0, [P, 2 * P, 3 * P, 4 * P]),
    (110.0, HA, HNCU, math.inf, []),
    (7.9, m.ANTENNAS["hsu"]["h"], HNCU, math.inf, []),
]

node = shutil.which("node")
if not node:
    print("SKIP paridad .py <-> .js: no hay node en el PATH")
else:
    js = """
    const Z = require(process.argv[1]);
    const casos = JSON.parse(process.argv[2]);
    const out = casos.map(c => {
      const [d, ht, hr, eps, xs] = c;
      const p = Object.assign(Z.defaultParams(), { epsR: eps === null ? Infinity : eps });
      const tabs = xs.map(x => { const b = Z.tableBand(0, %(H)s, %(CH)s, %(TILT)s, %(OFF)s); b.x = x; return b; });
      const r = Z.predictLink({x:0,y:0,ground:0,h:ht}, {x:d,y:0,ground:0,h:hr}, p, null, null, tabs);
      return [r.pl2rayDb, r.plDiffDb, r.marginDb];
    });
    console.log(JSON.stringify(out));
    """ % {"H": H, "CH": CH, "TILT": TILT, "OFF": OFF}
    casos_js = [[d, ht, hr, (None if math.isinf(e) else e), xs] for (d, ht, hr, e, xs) in CASOS]
    env = dict(os.environ)
    env.setdefault("NODE_PATH", "")
    try:
        salida = subprocess.run(
            [node, "-e", js, os.path.join(RAIZ, "web", "zigbee_pv_model.js"), json.dumps(casos_js)],
            capture_output=True, text=True, timeout=60, env=env, check=True).stdout
        jsres = json.loads(salida)
    except Exception as exc:                      # noqa: BLE001
        check("paridad .py <-> .js: el puerto JS corre", False, exc)
        jsres = None
    if jsres is not None:
        for i, (d, ht, hr, eps, xs) in enumerate(CASOS):
            p = m.LinkParams(eps_r=eps)
            tabs = [m.table_band(x, 0.0, H, CH, TILT, OFF) for x in xs]
            r = m.predict_link({"x": 0, "y": 0, "ground": 0, "h": ht},
                               {"x": d, "y": 0, "ground": 0, "h": hr}, p, tables=tabs)
            j = jsres[i]
            suelo = "perfecto" if math.isinf(eps) else "tierra real"
            check("paridad .py/.js — %.1f m, %.2f->%.2f m, %s, %d mesas"
                  % (d, ht, hr, suelo, len(xs)),
                  cerca(r["pl_2ray_db"], round(j[0], 2), 0.011) and
                  cerca(r["pl_diff_db"], round(j[1], 2), 0.011) and
                  cerca(r["margin_db"], round(j[2], 2), 0.011),
                  "py %s vs js %s" % ([r["pl_2ray_db"], r["pl_diff_db"], r["margin_db"]],
                                      [round(v, 2) for v in j]))

print("\n%d OK, %d FAIL" % (ok, ko))
sys.exit(1 if ko else 0)
