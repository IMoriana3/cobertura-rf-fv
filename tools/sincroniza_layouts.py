#!/usr/bin/env python3
"""TRAE LOS LAYOUTS DESDE `cobertura-zigbee`, QUE ES DONDE MANDAN.

    python3 tools/sincroniza_layouts.py                    # baja de GitHub (main)
    python3 tools/sincroniza_layouts.py --desde ../cobertura-zigbee
    python3 tools/sincroniza_layouts.py --ver              # solo dice que cambiaria

POR QUE EXISTE. La misma planta se dibuja en dos sitios: el visor de terreno de
`cobertura-zigbee` y este simulador de propagacion. Durante un tiempo cada repo
llevo su copia del `<planta>_layout.json`, y las copias SE SEPARARON sin que
nadie se enterase: al HSU1 de Tunez le faltaban su NCU y su GW, a Ayora su
bloque `hsu`, a El Burgo `tipos_largo` y `numeracion`, y una errata corregida en
un repo seguia viva en el otro (`bifila` contra `bifilo`). Ninguna de esas
diferencias era una decision: eran el poso de copiar a mano.

La implantacion es UNA. El CAD se procesa una vez, en `cobertura-zigbee`, y aqui
se trae. Este script es la unica manera de tocar `plantas/*_layout.json`; editar
una copia a mano deja el repo en rojo (`tests/test_layouts_procedencia.js`).

QUE NO HACE. No inventa ni recorta: copia el fichero TAL CUAL y apunta de donde
salio. Si algun dia este simulador necesitara algo que el layout de origen no
trae, lo que toca es anadirlo ALLI, no parchearlo aqui.
"""
import argparse, hashlib, json, os, sys, urllib.request, subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTAS = os.path.join(RAIZ, "plantas")
FUENTE = "IMoriana3/cobertura-zigbee"
CRUDO = "https://raw.githubusercontent.com/" + FUENTE + "/{ref}/{fichero}"
API = "https://api.github.com/repos/" + FUENTE + "/commits/main"
PROC = os.path.join(PLANTAS, "PROCEDENCIA.json")

def sha(b): return hashlib.sha256(b).hexdigest()

def cuales():
    """Las plantas que este simulador sirve, por los ficheros que ya tiene."""
    return sorted(f for f in os.listdir(PLANTAS) if f.endswith("_layout.json"))

def de_local(ruta, fichero):
    with open(os.path.join(ruta, fichero), "rb") as f: return f.read()

def de_github(ref, fichero):
    with urllib.request.urlopen(CRUDO.format(ref=ref, fichero=fichero), timeout=60) as r:
        return r.read()

def commit_local(ruta):
    try:
        sucio = subprocess.run(["git","-C",ruta,"status","--porcelain"],
                               capture_output=True, text=True, check=True).stdout.strip()
        if sucio:
            sys.exit("el checkout de origen tiene cambios sin commitear: no se puede "
                     "apuntar de donde sale el dato\n" + sucio)
        return subprocess.run(["git","-C",ruta,"rev-parse","HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sys.exit(f"{ruta} no parece un checkout de git de {FUENTE}")

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", help="checkout local de cobertura-zigbee (si no, se baja de GitHub)")
    ap.add_argument("--ver", action="store_true", help="no escribe: solo dice que cambiaria")
    a = ap.parse_args()

    if a.desde:
        ref = commit_local(a.desde); trae = lambda f: de_local(a.desde, f)
    else:
        with urllib.request.urlopen(API, timeout=60) as r: ref = json.load(r)["sha"]
        trae = lambda f: de_github(ref, f)

    ficheros, cambian = {}, []
    for f in cuales():
        try: nuevo = trae(f)
        except Exception as e:
            sys.exit(f"no se pudo traer {f} de {FUENTE}: {e}")
        destino = os.path.join(PLANTAS, f)
        viejo = open(destino, "rb").read() if os.path.exists(destino) else b""
        if nuevo != viejo:
            cambian.append((f, len(viejo), len(nuevo)))
            if not a.ver: open(destino, "wb").write(nuevo)
        ficheros[f] = {"origen": f, "sha256": sha(nuevo)}

    proc = {
        "_que_es": "De donde salen los layouts de esta carpeta. Lo escribe "
                   "tools/sincroniza_layouts.py y lo vigila "
                   "tests/test_layouts_procedencia.js: si una copia se edita a mano, rojo.",
        "_como_se_actualiza": "python3 tools/sincroniza_layouts.py",
        "fuente": {"repo": FUENTE, "rama": "main", "commit": ref},
        "ficheros": ficheros,
    }
    if not a.ver:
        with open(PROC, "w", encoding="utf-8") as f:
            json.dump(proc, f, ensure_ascii=False, indent=2); f.write("\n")

    print(f"origen {FUENTE}@{ref[:7]} · {len(ficheros)} layouts")
    for f, v, n in cambian: print(f"  {'(veria)' if a.ver else 'copiado'} {f}  {v} -> {n} bytes")
    if not cambian: print("  nada que traer: ya estaban al dia")
    # `--ver` SALE EN ROJO si hay algo que traer. Asi el vigia semanal del CI
    # (`.github/workflows/layouts_al_dia.yml`) no tiene que interpretar texto:
    # verde es "las copias son las de cobertura-zigbee".
    if a.ver and cambian: sys.exit(1)

if __name__ == "__main__":
    main()
