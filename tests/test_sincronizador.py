#!/usr/bin/env python3
"""Los guardas de `tools/sincroniza_desde_zigbee.py`.

QUE VIGILA. El sincronizador escribe en PROCEDENCIA.json de donde salio cada
copia, y ese registro dice literalmente "rama": "main". Si se sincroniza desde
una rama de trabajo, el commit que graba NO esta en main: es correcto el dia que
se escribe y deja de llevar a ningun sitio en cuanto la rama se rebasa o se
borra. Paso de verdad -- se grabo 8ef77ba, de una rama; el CONTENIDO coincidia
exactamente con main (los 12 ficheros, hash a hash), pero la referencia apuntaba
a algo que solo existia en una rama viva.

POR QUE AQUI Y NO EN LA CI DE CONTENIDO. `test_procedencia.js` compara hashes y
seguia verde con aquel commit, porque los hashes estaban bien. El defecto no era
el contenido sino la trazabilidad, y eso solo se puede atrapar en el momento de
sincronizar. De ahi que el guarda viva en la herramienta y este banco lo pruebe
contra repositorios de usar y tirar, sin red y sin depender del checkout hermano.
"""
import json, os, shutil, subprocess, sys, tempfile, importlib.util

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(RAIZ, "tools", "sincroniza_desde_zigbee.py")

ok = ko = 0
def check(que, cond, extra=""):
    global ok, ko
    if cond: ok += 1; print("OK   " + que)
    else:    ko += 1; print("FALLO " + que + ((" -- " + extra) if extra else ""))

def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args),
                          capture_output=True, text=True, check=True)

def corre(desde, entorno=None):
    env = dict(os.environ)
    if entorno: env.update(entorno)
    r = subprocess.run([sys.executable, TOOL, "--desde", desde, "--ver"],
                       capture_output=True, text=True, cwd=RAIZ, env=env)
    return r.returncode, (r.stdout + r.stderr)

def pares():
    """Los mismos pares (aqui, alli) que usa la herramienta, sin duplicarlos."""
    spec = importlib.util.spec_from_file_location("sinc", TOOL)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod.cuales()

def finge_zigbee(base, rama_principal="main"):
    """Un cobertura-zigbee de mentira con los 12 ficheros que se sincronizan."""
    os.makedirs(base, exist_ok=True)
    for aqui, alli in pares():
        destino = os.path.join(base, alli)
        os.makedirs(os.path.dirname(destino) or base, exist_ok=True)
        shutil.copyfile(os.path.join(RAIZ, aqui), destino)
    git(base, "init", "-q", "-b", rama_principal)
    git(base, "config", "user.email", "banco@local")
    git(base, "config", "user.name", "banco")
    git(base, "add", "-A")
    git(base, "commit", "-q", "-m", "los ficheros que se sincronizan")
    return base

print("### los guardas del sincronizador ###")
tmp = tempfile.mkdtemp(prefix="sinc_")
try:
    # ---- 1. desde `main`: pasa, y no trae nada porque las copias ya casan ----
    repo = finge_zigbee(os.path.join(tmp, "zigbee"))
    rc, sal = corre(repo)
    check("desde `main` sincroniza sin quejarse", rc == 0, f"rc={rc} · {sal.strip()[:200]}")
    check("y no encuentra nada que traer (las copias ya casan)",
          rc == 0 and "nada que traer" in sal, sal.strip()[:200])

    # ---- 2. desde una rama que no esta en main: se niega ----
    git(repo, "checkout", "-q", "-b", "trabajo")
    with open(os.path.join(repo, "_suelto.txt"), "w") as f: f.write("solo en la rama\n")
    git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "un commit que no esta en main")
    cabeza = git(repo, "rev-parse", "HEAD").stdout.strip()
    rc, sal = corre(repo)
    check("desde una rama fuera de `main` se NIEGA a sincronizar", rc != 0, f"rc={rc}")
    check("y lo dice nombrando el commit y la rama principal",
          cabeza[:12] in sal and "main" in sal, sal.strip()[:200])
    check("y propone el arreglo (fetch/checkout), no solo el problema",
          "checkout" in sal, sal.strip()[:200])

    # ---- 3. MUTACION: sin el guarda, ese mismo caso pasaria ----
    #  Es la comprobacion de que lo que hace fallar al caso 2 es EL GUARDA y no
    #  cualquier otra cosa del camino (un fichero que falte, un git que chille).
    rc, sal = corre(repo, {"PROCEDENCIA_RAMA_LIBRE": "si"})
    check("MUTACION `PROCEDENCIA_RAMA_LIBRE=si`: sin guarda, la rama colaria",
          rc == 0, f"rc={rc} · {sal.strip()[:200]}")

    # ---- 4. el guarda viejo sigue vivo: arbol sucio ----
    git(repo, "checkout", "-q", "main")
    sucio = os.path.join(repo, [a for _, a in pares()][0])
    with open(sucio, "ab") as f: f.write(b"\n// tocado a mano\n")
    rc, sal = corre(repo)
    check("con el checkout de origen sucio tampoco sincroniza", rc != 0, f"rc={rc}")
    check("y dice que es por cambios sin commitear",
          "sin commitear" in sal, sal.strip()[:200])
    git(repo, "checkout", "-q", "--", ".")

    # ---- 5. ni `origin/main` ni `main`: no se puede comprobar, no se adivina ----
    raro = finge_zigbee(os.path.join(tmp, "raro"), rama_principal="maestra")
    rc, sal = corre(raro)
    check("sin `main` ni `origin/main` se niega en vez de dar por bueno",
          rc != 0 and "no se puede comprobar" in sal, f"rc={rc} · {sal.strip()[:200]}")

    # ---- 6. `origin/main` manda sobre `main` cuando estan los dos ----
    #  Lo publicado es `origin/main`. Un `main` local adelantado no basta: grabar
    #  un commit que aun no esta publicado es el mismo defecto un dia antes.
    dos = finge_zigbee(os.path.join(tmp, "dos"))
    git(dos, "update-ref", "refs/remotes/origin/main", "HEAD")
    with open(os.path.join(dos, "_local.txt"), "w") as f: f.write("solo en el main local\n")
    git(dos, "add", "-A"); git(dos, "commit", "-q", "-m", "main local por delante de origin/main")
    rc, sal = corre(dos)
    check("un `main` local por delante de `origin/main` NO vale",
          rc != 0 and "origin/main" in sal, f"rc={rc} · {sal.strip()[:200]}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print()
print(f"TODAS OK ({ok} comprobaciones)" if not ko else f"{ko} FALLOS de {ok+ko}")
sys.exit(1 if ko else 0)
