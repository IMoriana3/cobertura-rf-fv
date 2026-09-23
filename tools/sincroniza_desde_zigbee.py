#!/usr/bin/env python3
"""TRAE DE `cobertura-zigbee` LO QUE ES SUYO: los layouts y los modulos comunes.

    python3 tools/sincroniza_desde_zigbee.py                    # baja de GitHub (main)
    python3 tools/sincroniza_desde_zigbee.py --desde ../cobertura-zigbee
    python3 tools/sincroniza_desde_zigbee.py --ver              # solo dice que cambiaria

POR QUE EXISTE. La misma planta se dibuja en dos sitios —el visor de terreno de
`cobertura-zigbee` y este simulador de propagacion— y con el mismo modelo de
seguidor. Cada repo llevaba SU copia, y las copias SE SEPARARON sin que nadie se
enterase. En los layouts: al HSU1 de Tunez le faltaban su NCU y su GW, a Ayora su
bloque `hsu`, a El Burgo `tipos_largo`. Y en los MODULOS, que es peor:

  · `seguidor.js` iba 59 lineas por detras aqui... y las DOS copias declaraban
    ser la `0.4.23`. Una version que miente es peor que no tener version: quita
    justo la pregunta que la habria descubierto.
  · `sol.js` iba de la 0.2.0 contra la 0.3.0 de alla (este al menos lo decia).
  · `equipos.js` se habia quedado con la cabecera VIEJA, la que situa los
    latigos de la HSU a «~8,3 m» cuando su propio codigo ya dice 6,50 desde que
    se corrigio la cota. Los numeros coincidian —no habia fallo de fisica— pero
    el fichero se contradecia a si mismo.

Ninguna de esas diferencias era una decision: eran el poso de copiar a mano.

QUE MANDA. El CAD se procesa UNA vez, alli, y el modelo del seguidor y los dos
equipos de planta viven alli. Aqui se traen. Este script es la unica manera de
tocarlos; editar una copia a mano deja el repo en rojo
(`tests/test_procedencia.js`).

QUE NO HACE. No inventa ni recorta: copia el fichero TAL CUAL y apunta de donde
salio. Si algun dia este simulador necesitara algo que el origen no trae, lo que
toca es anadirlo ALLI.
"""
import argparse, hashlib, json, os, sys, urllib.request, subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTAS = os.path.join(RAIZ, "plantas")
FUENTE = "IMoriana3/cobertura-zigbee"
CRUDO = "https://raw.githubusercontent.com/" + FUENTE + "/{ref}/{fichero}"
API = "https://api.github.com/repos/" + FUENTE + "/commits/main"
PROC = os.path.join(RAIZ, "PROCEDENCIA.json")

def sha(b): return hashlib.sha256(b).hexdigest()

# Los modulos comunes viven en la RAIZ de los dos repos, con el mismo nombre.
MODULOS = ["seguidor.js", "equipos.js", "sol.js", "secc.json"]

def cuales():
    """Pares (aqui, alli): donde va el fichero y de donde sale.

    LAS RUTAS NO COINCIDEN, y por eso esto devuelve pares en vez de nombres. En
    `cobertura-zigbee` los layouts estan en la RAIZ (`ayora_layout.json`); aqui
    viven en `plantas/`. Los modulos comunes si estan en la raiz en los dos.

    Los layouts salen de lo que esta carpeta ya tiene: este simulador sirve ocho
    plantas de las once del indice, y elegir cuales no es cosa de este script.
    Los modulos son una lista fija: son el contrato entre los dos repos."""
    lay = sorted(("plantas/" + f, f)
                 for f in os.listdir(PLANTAS) if f.endswith("_layout.json"))
    return lay + [(m, m) for m in MODULOS if os.path.exists(os.path.join(RAIZ, m))]

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
    for aqui, alli in cuales():
        try: nuevo = trae(alli)
        except Exception as e:
            sys.exit(f"no se pudo traer {alli} de {FUENTE}: {e}")
        destino = os.path.join(RAIZ, aqui)
        viejo = open(destino, "rb").read() if os.path.exists(destino) else b""
        if nuevo != viejo:
            cambian.append((aqui, len(viejo), len(nuevo)))
            if not a.ver: open(destino, "wb").write(nuevo)
        ficheros[aqui] = {"origen": alli, "sha256": sha(nuevo)}

    proc = {
        "_que_es": "De donde salen los layouts y los modulos comunes de este repo. "
                   "Lo escribe tools/sincroniza_desde_zigbee.py y lo vigila "
                   "tests/test_procedencia.js: si una copia se edita a mano, rojo.",
        "_como_se_actualiza": "python3 tools/sincroniza_desde_zigbee.py",
        "fuente": {"repo": FUENTE, "rama": "main", "commit": ref},
        "ficheros": ficheros,
    }
    if not a.ver:
        with open(PROC, "w", encoding="utf-8") as f:
            json.dump(proc, f, ensure_ascii=False, indent=2); f.write("\n")

    print(f"origen {FUENTE}@{ref[:7]} · {len(ficheros)} ficheros")
    for f, v, n in cambian: print(f"  {'(veria)' if a.ver else 'copiado'} {f}  {v} -> {n} bytes")
    if not cambian: print("  nada que traer: ya estaban al dia")
    # `--ver` SALE EN ROJO si hay algo que traer. Asi el vigia semanal del CI
    # (`.github/workflows/layouts_al_dia.yml`) no tiene que interpretar texto:
    # verde es "las copias son las de cobertura-zigbee".
    if a.ver and cambian: sys.exit(1)

if __name__ == "__main__":
    main()
