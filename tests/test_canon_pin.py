#!/usr/bin/env python3
"""LAS COPIAS FIJADAS DEL CANON DE RADIO, CAREADAS CONTRA SU ORIGINAL.

`radio_pv_model` vive en `siting`. Aqui hay una copia porque el visor de este
repo es un HTML servido desde Pages y no puede leer un repo hermano en tiempo de
ejecucion — y porque `python/zigbee_pv_model.py` corre en la CI de este repo,
que clona este repo y nada mas.

POR QUE ESTE BANCO EXISTE. Una copia sin quien la caree se queda vieja en
silencio. Es literalmente lo que le paso a SolarGPTfull con `zigbee_pv_model.js`:
entro dentro de un commit sobre otra cosa, se quedo dos meses por detras del
canon, y sus parametros daban 4,8 dB de diferencia sin que nadie lo supiera. El
candado por sha256 sin careo NO arregla eso: un candado que cuadra consigo mismo
no dice NADA sobre si la copia esta al dia.

    python3 tests/test_canon_pin.py
    MUTA=<clave> python3 tests/test_canon_pin.py     (TIENE que salir rojo)

rc = 0 careado y coincide · 1 discrepa · 2 NO SE HA PODIDO CAREAR
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON_URL = 'https://github.com/IMoriana3/siting.git'
PISO_COPIAS = 2      # el .js del visor y el .py del nucleo: menos es no mirar
PISO_MUT = 8

ok = [0]
ko = [0]


def check(nombre, cond, extra=None):
    if cond:
        ok[0] += 1
        print('OK   ' + nombre)
    else:
        ko[0] += 1
        print('FAIL ' + nombre + ('' if extra is None else ' -> ' + str(extra)))


def sha(ruta):
    with open(ruta, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


# ── MUTACIONES ───────────────────────────────────────────────────────────────
# Cada una tiene que sacar este banco en ROJO (rc = 1). Un rc = 2 no vale: seria
# «no he podido mirar», que es justo lo que este banco esta aqui para distinguir.
MUTACIONES = {
    # la copia se desvia del canon por un byte: el caso que este banco existe
    # para cazar, y el que le paso de verdad a SolarGPTfull
    'copiaDesviada': ('lib/radio_pv_model.js',
                      'var C_LUZ = 299792458;', 'var C_LUZ = 299792459;'),
    # el candado deja de corresponder con el fichero que fija
    'candadoRancio': ('lib/canon.lock.json',
                      '"sha256": "8a68a48c', '"sha256": "00000000'),
    # una copia se cae del repo y el candado sigue prometiendola
    'copiaQueFalta': ('BORRA', 'python/radio_pv_model.py', None),
    # la procedencia se queda en un hueco: el careo puede seguir dando verde, pero
    # el dia que salga rojo no hay por donde empezar a mirar
    'procedenciaHueca': ('lib/canon.lock.json',
                         '"commit": "331ed7a5', '"commit": "PENDIENTE'),
    # vuelve una SEGUNDA copia de la formula al lado del canon: el estado del que
    # se sale con esto, y al que se vuelve solo, callando, en cualquier arreglo
    # rapido «para no tocar el canon»
    'formulaDuplicada': ('web/zigbee_pv_model.js',
                         'const F_DEF = 2.45e9', 'const FSPL_K = 147.55;\n  const F_DEF = 2.45e9'),
    # el puerto se queda SIN GUARDIA: sin canon ya no se para, y calcula con medio
    # motor hasta que reviente en otro sitio y con otro mensaje
    'puertoSinGuardia': ('web/zigbee_pv_model.js',
                         'if (!RPV) {', 'if (false) {'),
    # el puerto JS deja de delegar y se escribe su propia cuenta: la copia fijada
    # sigue impecable y no la usa nadie
    'puertoCopiaJs': ('web/zigbee_pv_model.js',
                      'const fsplDb = (dM, fHz = F_DEF) => RPV.fsplDb(dM, fHz);',
                      'const fsplDb = (dM, fHz = F_DEF) => 20 * Math.log10(Math.max(dM, 1e-3)) + 20 * Math.log10(fHz) - 147.55;'),
    # y lo mismo en el puerto Python
    'puertoCopiaPy': ('python/zigbee_pv_model.py',
                      '    return _RPV.fspl_db(d_m, f_hz)',
                      '    return 20 * math.log10(max(d_m, 1e-3)) + 20 * math.log10(f_hz) - 147.55'),
}

MUTA = os.environ.get('MUTA')
DIR = RAIZ
if MUTA:
    if MUTA not in MUTACIONES:
        print('mutacion desconocida. Hay: ' + ', '.join(MUTACIONES))
        sys.exit(2)
    # Se copia TODO el texto del repo (.js/.py/.html) mas el candado, no solo los
    # tres ficheros fijados: si no, la comprobacion de «una sola implementacion»
    # miraria un arbol vacio y saldria verde por no tener donde mirar. El binario
    # (modelos, imagenes de referencia) no hace falta y no se copia.
    DIR = tempfile.mkdtemp(prefix='canonpin-')
    for base, dirs, files in os.walk(RAIZ):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules')]
        for f in files:
            if not (f.endswith(('.js', '.py', '.html')) or f == 'canon.lock.json'):
                continue
            rel = os.path.relpath(os.path.join(base, f), RAIZ)
            dst = os.path.join(DIR, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(base, f), dst)
    donde, a, b = MUTACIONES[MUTA]
    if donde == 'BORRA':
        os.remove(os.path.join(DIR, a))
    else:
        dst = os.path.join(DIR, donde)
        with open(dst, 'r', encoding='utf-8') as f:
            antes = f.read()
        despues = antes.replace(a, b, 1)
        if despues == antes:
            print('la mutacion «%s» no caso con %s. Eso es NO COMPROBADO, no rojo.'
                  % (MUTA, donde))
            sys.exit(2)
        with open(dst, 'w', encoding='utf-8') as f:
            f.write(despues)
    print('### MUTACION «%s» PUESTA: este banco TIENE que salir rojo\n' % MUTA)

# ── A · EL CANDADO ───────────────────────────────────────────────────────────
f_lock = os.path.join(DIR, 'lib/canon.lock.json')
check('el candado esta donde se espera', os.path.isfile(f_lock), f_lock)
if not os.path.isfile(f_lock):
    print('\nFALLAN %d' % ko[0])
    sys.exit(1)

lock = json.load(open(f_lock, encoding='utf-8'))
check('el candado declara su canon (repo y rama)',
      lock.get('canon', {}).get('repo') == 'imoriana3/siting'
      and lock['canon'].get('rama') == 'main',
      json.dumps(lock.get('canon')))
# La procedencia tiene que ser un commit de verdad, no un hueco ni un «PENDIENTE».
# No prueba que la copia este al dia —para eso esta el careo de mas abajo— pero
# sin el no hay por donde empezar a mirar cuando el careo salga rojo.
_c = str(lock.get('canon', {}).get('commit', ''))
check('y de que commit de ese canon salio',
      len(_c) == 40 and all(x in '0123456789abcdef' for x in _c), _c)
copias = lock.get('copias') or []
check('el candado fija al menos %d copias' % PISO_COPIAS, len(copias) >= PISO_COPIAS,
      len(copias))

# ── B · CADA COPIA, CONTRA SU SHA DECLARADO ──────────────────────────────────
presentes = []
for c in copias:
    aqui = os.path.join(DIR, c['aqui'])
    hay = os.path.isfile(aqui)
    check('la copia %s esta en el repo' % c['aqui'], hay)
    if not hay:
        continue
    s = sha(aqui)
    check('  y su sha256 casa con el candado', s == c['sha256'],
          s[:16] + ' vs ' + c['sha256'][:16])
    presentes.append((c, aqui, s))

# ── C · Y CONTRA EL CANON DE VERDAD, QUE ES LO QUE DA SENTIDO AL RESTO ───────
# El candado cuadrando consigo mismo no dice NADA sobre si la copia esta al dia:
# para eso hace falta el original. Se busca el clon al lado (el modo normal
# trabajando) y si no lo hay se trae con --depth 1, que `siting` es PUBLICO.
# Misma idea, mismo orden y mismos codigos que `docs/enlace_guia.sh`.
hermano = None
comovino = None
for cand in ('../siting', '../Siting'):
    p = os.path.join(RAIZ, cand)
    if os.path.isfile(os.path.join(p, 'radio_pv_model.js')):
        hermano, comovino = p, 'clon al lado (%s)' % cand
        break

tmpclon = None
if hermano is None:
    tmpclon = tempfile.mkdtemp(prefix='canon-')
    r = subprocess.run(['git', 'clone', '--depth', '1', '-q', CANON_URL,
                        os.path.join(tmpclon, 's')],
                       capture_output=True)
    if r.returncode == 0:
        hermano, comovino = os.path.join(tmpclon, 's'), 'clonado al vuelo (--depth 1)'

if hermano is None:
    if tmpclon:
        shutil.rmtree(tmpclon, ignore_errors=True)
    print('\nNO SE HA PODIDO CAREAR: no hay clon de `siting` al lado y no se ha')
    print('podido clonar. El candado cuadra consigo mismo, que no dice NADA sobre')
    print('si la copia esta al dia.')
    print('«No he podido mirar» no es «esta bien».')
    sys.exit(2)

print('\nel canon, %s\n' % comovino)
for c, aqui, s in presentes:
    alli = os.path.join(hermano, c['alli'])
    if not os.path.isfile(alli):
        check('%s existe en el canon' % c['alli'], False,
              'el canon ya no lo trae: o se movio, o esta copia fija algo que murio')
        continue
    sc = sha(alli)
    check('%s es IDENTICA al canon, byte a byte' % c['aqui'], sc == s,
          'canon ' + sc[:16] + ' · copia ' + s[:16])

if tmpclon:
    shutil.rmtree(tmpclon, ignore_errors=True)

# ── D · Y QUE NO HAYA UNA SEGUNDA COPIA DE LA FÍSICA SUELTA POR AHÍ ──────────
# Fijar el canon no sirve de nada si al lado sigue viviendo la misma fórmula
# escrita a mano: eso es justo lo que había antes del 2026-09-24 y lo que hace
# que una de las dos se quede vieja sin que nadie lo note. Las constantes de
# abajo sólo pueden aparecer en el canon; en cualquier otro fichero de este repo
# son una segunda implementación.
#
# NO es una prueba de que la física sea correcta —eso lo carea
# `siting/tools/careo_rffv.py` sobre 2.408 casos— sino de que sea UNA.
HUELLAS = [
    ('147.55', 'la constante del espacio libre'),
    ('6.9 + 20', 'el filo de cuchillo de ITU-R P.526'),
    ('60.0 * lam', 'la permitividad compleja del coeficiente de reflexión'),
    ('299792458', 'la velocidad de la luz'),
    ('299_792_458', 'la velocidad de la luz'),
]
SOLO_EN = {'lib/radio_pv_model.js', 'python/radio_pv_model.py',
           'tests/test_canon_pin.py'}          # este banco las nombra para buscarlas
FUERA = ('node_modules', 'lib/three', 'lib/OrbitControls', 'lib/GLTFLoader', '.git')


def sin_comentarios(txt):
    """Quita comentarios antes de buscar. SIN ESTO LA PUERTA SE ENGAÑA SOLA: la
    primera version de la comprobacion de abajo daba VERDE con el `require` del
    canon arrancado, porque la cabecera del fichero nombraba
    `lib/radio_pv_model.js` en un comentario y eso le bastaba. Una guardia que se
    conforma con la prosa vigila la prosa."""
    txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)        # bloque de JS/CSS
    txt = re.sub(r'"""[\s\S]*?"""', ' ', txt)               # docstring de Python
    txt = re.sub(r'<!--.*?-->', ' ', txt, flags=re.S)       # comentario de HTML
    fuera = []
    for linea in txt.split('\n'):
        linea = re.sub(r'(?<!:)//.*$', '', linea)           # `//`, pero no en https://
        linea = re.sub(r'#.*$', '', linea)                  # `#` de Python
        fuera.append(linea)
    return '\n'.join(fuera)


mirados, duplicados = 0, []
for base, dirs, files in os.walk(DIR):
    dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules')]
    for f in files:
        if not f.endswith(('.js', '.py', '.html')):
            continue
        rel = os.path.relpath(os.path.join(base, f), DIR).replace(os.sep, '/')
        if rel in SOLO_EN or any(x in rel for x in FUERA):
            continue
        mirados += 1
        try:
            txt = sin_comentarios(open(os.path.join(base, f), encoding='utf-8',
                                      errors='replace').read())
        except OSError:
            continue
        for huella, que in HUELLAS:
            if huella in txt:
                duplicados.append('%s lleva %s («%s»)' % (rel, que, huella))

check('la física de las primitivas está escrita UNA vez (%d ficheros mirados)' % mirados,
      not duplicados, ' · '.join(duplicados[:3]))

# ── D bis · Y QUE LOS DOS PUERTOS LA TOMEN DE AHÍ, DE VERDAD ─────────────────
# Buscar el `require` en el texto NO vale: la primera version de esto daba verde
# con el require arrancado, porque el nombre del canon seguia saliendo en la
# cabecera y en el texto del error. Asi que se COMPRUEBA EJECUTANDO, y las dos
# cosas que de verdad importan:
#
#   1. sin el canon, el puerto SE PARA. Un respaldo silencioso seria exactamente
#      la averia que esto viene a cerrar.
#   2. si al canon se le cambia una primitiva, la del puerto CAMBIA CON ELLA.
#      Eso no lo puede fingir una copia: o delega o no delega.
no_mirado = []

PRUEBA_JS = r'''
const fs = require('fs'), vm = require('vm');
const canon = process.argv[2], puerto = process.argv[3];
let paro = false, msg = '';
try {
  const ctx = { module: { exports: {} }, console, require: function () { return null; },
                window: undefined };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(puerto, 'utf8'), ctx);
} catch (e) { paro = true; msg = String(e && e.message || e); }
const RPV = require(canon), Z = require(puerto);
const antes = Z.fsplDb(100, 2.45e9);
const orig = RPV.fsplDb;
RPV.fsplDb = function (d, f) { return orig(d, f) + 7; };
const despues = Z.fsplDb(100, 2.45e9);
RPV.fsplDb = orig;
console.log(JSON.stringify({ paro: paro, msg: msg.slice(0, 90),
                             sigue: Math.abs((despues - antes) - 7) < 1e-12 }));
'''

_pjs = os.path.join(tempfile.mkdtemp(prefix='pruebajs-'), 'p.js')
with open(_pjs, 'w', encoding='utf-8') as fh:
    fh.write(PRUEBA_JS)
try:
    r = subprocess.run(['node', _pjs,
                        os.path.join(DIR, 'lib/radio_pv_model.js'),
                        os.path.join(DIR, 'web/zigbee_pv_model.js')],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        check('el puerto JS se deja cargar para mirarlo', False,
              (r.stderr or '').strip().split('\n')[-1][:90])
    else:
        d = json.loads(r.stdout.strip().split('\n')[-1])
        check('sin el canon, el puerto JS SE PARA (no calcula con medio motor)',
              d['paro'] and 'radio_pv_model' in d['msg'], d['msg'] or 'no se paró')
        check('y toca el canon una primitiva: la del puerto JS cambia con ella',
              d['sigue'], 'no siguió al canon: lleva su propia cuenta')
except FileNotFoundError:
    no_mirado.append('no hay `node` para comprobar el puerto JS ejecutándolo')
except Exception as e:                                        # noqa: BLE001
    no_mirado.append('el puerto JS no se ha podido ejecutar: %s' % str(e)[:60])

# El puerto Python se mira desde aquí mismo, sin subproceso.
sys.path.insert(0, os.path.join(DIR, 'python'))
try:
    import radio_pv_model as _C
    import zigbee_pv_model as _Z
    _antes = _Z.fspl_db(100, 2.45e9)
    _orig = _C.fspl_db
    _C.fspl_db = lambda d, f: _orig(d, f) + 7
    _despues = _Z.fspl_db(100, 2.45e9)
    _C.fspl_db = _orig
    check('y toca el canon una primitiva: la del puerto Python cambia con ella',
          abs((_despues - _antes) - 7) < 1e-12,
          'no siguió al canon: lleva su propia cuenta')
except Exception as e:                                        # noqa: BLE001
    check('el puerto Python se deja cargar para mirarlo', False, str(e)[:90])

# ── E · Y QUE LA COPIA SEA USABLE, NO SOLO IGUAL ─────────────────────────────
# Un fichero identico al canon que nadie carga no sirve de nada. Esto comprueba
# que el modulo se deja importar y expone lo que este repo le pide.
try:
    import radio_pv_model as C
    check('la copia .py se importa', True)
    for n in ('fspl_db', 'perdida_filo_db', 'radio_fresnel', 'distancia_ruptura',
              'dos_rayos_db', 'nu', 'longitud_onda', 'ganancia_patron_db'):
        check('  expone %s' % n, hasattr(C, n))
except Exception as e:                                        # noqa: BLE001
    check('la copia .py se importa', False, str(e)[:80])

# ── EL ALCANCE, Y EN QUE ORDEN SE DECIDE ─────────────────────────────────────
print('\nalcance: %d copias fijadas careadas byte a byte contra su canon (piso %d) · '
      '%d mutaciones (piso %d)' % (len(presentes), PISO_COPIAS,
                                   len(MUTACIONES), PISO_MUT))
print('')

# UN ROJO NO SE DEGRADA A «NO COMPROBADO». El orden importa y la primera version
# de este banco lo tenia al reves: la mutacion `copiaQueFalta` sacaba rc = 2
# porque al faltar un fichero la poblacion bajaba del piso, y el piso se miraba
# ANTES que los FAIL. Pero ahi habia FAIL: el banco SI habia cazado el defecto y
# lo publicaba con el codigo de «no he podido mirar», que es el codigo que este
# repo usa para decir lo contrario. Primero el rojo, despues el piso.
if ko[0]:
    print('FALLAN %d de %d comprobaciones' % (ko[0], ok[0] + ko[0]))
    sys.exit(1)

for _m in no_mirado:
    print('SIN COMPROBAR: ' + _m)
if no_mirado:
    print('Nada ha fallado, pero algo no se ha mirado. Eso NO es un verde.')
    sys.exit(2)

if len(presentes) < PISO_COPIAS or len(MUTACIONES) < PISO_MUT:
    print('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante.')
    sys.exit(2)

print('TODO OK — %d comprobaciones' % ok[0])
