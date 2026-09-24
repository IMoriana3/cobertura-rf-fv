#!/usr/bin/env python3
"""¿ESTÁN TODOS LOS BANCOS DE ESTE REPO EN LA CI?

UNA PUERTA QUE NADIE MIRA NO ES UNA PUERTA. Un banco que existe, pasa en verde y
no lo corre nadie no vigila nada: es una promesa. Este censo lo encontró el
2026-09-24 con `tests/test_demo_cobertura.js`, que llevaba en el repo sin
aparecer en ningún workflow — daba 33 de 33, pero por suerte, no por vigilancia.

QUÉ MIRA, Y QUÉ NO. Mira la DECLARACIÓN: que cada `tests/test_*` del disco salga
en algún workflow, sea por su nombre o como valor de la matriz. NO mira si la
corrida termina, ni si un `if:` la salta, ni si el runner existe: eso es otra
pregunta y la contesta `proyectos/docs/ci_al_dia.sh` al empezar cada sesión,
mirando el último CI de `main` de verdad. Un banco declarado y no corrido sigue
siendo posible; este censo cierra el hueco más grande y dice cuál deja abierto.

    python3 tests/test_censo_bancos.py
    MUTA=bancoHuerfano python3 tests/test_censo_bancos.py    (TIENE que salir rojo)

rc = 0 todos declarados · 1 alguno huérfano · 2 no se ha podido mirar
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLUJOS = os.path.join(RAIZ, '.github', 'workflows')
PISO_BANCOS = 12      # MEDIDO el 2026-09-24: hay 13 en tests/
PISO_FLUJOS = 1

MUTA = os.environ.get('MUTA')

if not os.path.isdir(FLUJOS):
    print('NO SE HA PODIDO MIRAR: no hay .github/workflows en %s' % RAIZ)
    print('«No he podido mirar» no es «está bien».')
    sys.exit(2)

bancos = sorted(f for f in os.listdir(os.path.join(RAIZ, 'tests'))
                if re.match(r'^test_.*\.(js|py)$', f))
ymls = sorted(f for f in os.listdir(FLUJOS) if f.endswith(('.yml', '.yaml')))

texto = ''
for y in ymls:
    with open(os.path.join(FLUJOS, y), encoding='utf-8') as fh:
        texto += fh.read() + '\n'

# LA MUTACIÓN se lleva por delante TODAS las menciones de un banco, que es lo que
# pasa de verdad cuando alguien reordena una matriz y se deja una fila fuera.
if MUTA == 'bancoHuerfano':
    victima = 'test_zonas_ncu.js'
    texto = texto.replace(victima, 'test_QUE_NO_EXISTE.js')
    print('### MUTACION «bancoHuerfano» PUESTA (%s fuera): este censo TIENE que '
          'salir rojo\n' % victima)
elif MUTA:
    print('mutacion desconocida. Hay: bancoHuerfano')
    sys.exit(2)

# Dos formas de que un banco esté en la CI: por su nombre, o como valor de la
# matriz que luego se usa con `tests/${{ matrix.banco }}`.
declarados = set(re.findall(r'tests/(test_[A-Za-z0-9_]+\.(?:js|py))', texto))
declarados |= set(re.findall(r'banco:\s*(test_[A-Za-z0-9_]+\.(?:js|py))', texto))

huerfanos = [b for b in bancos if b not in declarados]
fantasmas = sorted(d for d in declarados if d not in bancos)

print('CENSO DE BANCOS · %d en tests/ · %d flujos leídos (%s)\n'
      % (len(bancos), len(ymls), ', '.join(ymls)))
for b in bancos:
    print('  %-28s %s' % (b, 'en la CI' if b in declarados else '*** NO LO CORRE NADIE ***'))

print('\nalcance: %d bancos censados (piso %d) · %d flujos (piso %d)'
      % (len(bancos), PISO_BANCOS, len(ymls), PISO_FLUJOS))
print('esto mira la DECLARACIÓN, no la corrida: si un job se salta por un `if:`,'
      ' lo dice el censo de CI de proyectos, no este.\n')

if huerfanos:
    print('ROJO · %d banco(s) que no corre nadie: %s' % (len(huerfanos), ', '.join(huerfanos)))
    print('       Añádelos a .github/workflows/bancos.yml o bórralos, pero no los')
    print('       dejes ahí pareciendo que vigilan algo.')
    sys.exit(1)

if fantasmas:
    print('ROJO · la CI llama a %d banco(s) que NO están en tests/: %s'
          % (len(fantasmas), ', '.join(fantasmas)))
    print('       Eso es una corrida que falla por no encontrar el fichero, o peor,')
    print('       un paso que nadie mira porque siempre se salta.')
    sys.exit(1)

if len(bancos) < PISO_BANCOS or len(ymls) < PISO_FLUJOS:
    print('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante.')
    sys.exit(2)

print('TODO OK — los %d bancos de tests/ salen en la CI' % len(bancos))
