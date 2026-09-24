#!/usr/bin/env python3
"""
radio_pv_model.py — el MISMO motor que `radio_pv_model.js`, en Python.

POR QUÉ EXISTE ESTE FICHERO
El visor predice en JS y la calibración ajusta en Python. Si los dos no
resuelven la misma geometría con las mismas ecuaciones, el ajuste calibra un
modelo que nadie usa y el mapa pinta un modelo que nadie ha ajustado: los
parámetros salen «buenos» en la hoja y no cuadran en pantalla, y no hay forma
de saber cuál de los dos miente. Ya pasó una vez en este repo —dos cifras de
sesgo conviviendo, −33,6 y −16,58, sin que ninguna reprodujera a la otra— y el
banco `tests/test_paridad_radio.py` está para que no vuelva a pasar.

CÓMO SE MANTIENE LA PARIDAD. No a ojo: `tests/test_paridad_radio.py` corre los
dos motores sobre el mismo barrido de casos y exige que coincidan. Si alguien
toca una fórmula aquí y no allí —o al revés—, el banco lo dice. Es el mismo
mecanismo con el que SolarGPTfull tiene pinchado el modelo antiguo contra
`factiun_core.rf` a 0,000000 dB.

UNA SOLA FUNCIÓN DE DESPEJE. El despeje de una fila lo da `corta_panel` y nadie
más. La banda vertical —`banda`/`corta`— ya no vive aquí: está en
`tests/referencia_banda_vertical.js`, con otro nombre y sólo para carearla.

QUÉ NO HAY AQUÍ. Ningún sesgo global, ningún número de potencia, sensibilidad
ni regulación: eso vive en `radio_params.json`, con su procedencia. Esto son
solo geometría y ecuaciones de pérdida.

ORDEN DE LAS OPERACIONES. Está calcado del JS a propósito, incluso donde
reordenar sería más legible. En coma flotante `(a*b)*c` y `a*(b*c)` no son el
mismo número, y la paridad se mide en dB, no en «parecido».
"""
from __future__ import annotations
import math

# ═══ GEOMETRÍA ═════════════════════════════════════════════════════════════
# Nada de aquí abajo sabe en qué frecuencia se emite.

GRADO = math.pi / 180


def bajo_tierra(eje_m, cuerda_m, alpha_deg, suelo_m=None):
    """Espejo de `bajoTierra()`. Con el eje a 1,20 el borde bajo se acerca al
    suelo: 1,20 − (c/2)·sen alfa. No toca en el rango de trabajo, pero con
    cuerda 2,411 cruza el cero a 84,52 grados y el barrido llega a 90.

    Se DEVUELVE el diagnostico, no se corrige: taparlo subiendo el borde al
    suelo daria un numero plausible sobre una planta que no existe."""
    suelo = 0.0 if suelo_m is None else suelo_m
    z_bot = eje_m - (cuerda_m / 2.0) * abs(math.sin(alpha_deg * GRADO))
    r = 2.0 if suelo == eje_m else (eje_m - suelo) / (cuerda_m / 2.0)
    return {
        "zBot": z_bot,
        "bajoTierra": z_bot < suelo,
        "hundimientoM": (suelo - z_bot) if z_bot < suelo else 0,
        "alphaCorteDeg": None if r >= 1 else math.asin(r) / GRADO,
        "motivo": "borde_del_modulo_bajo_el_suelo" if z_bot < suelo else None,
    }


def altura_rayo(zA, zB, D, s):
    """Espejo de `alturaRayo()`."""
    if D <= 0:
        return zA
    return zA + (zB - zA) * (s / D)


def altura_eje(montaje, defecto_m):
    """Espejo de `alturaEje()`. LA ALTURA DEL EJE ES POR PLANTA, nunca una
    constante global escondida: si la planta no la declara se cae al defecto
    CON MOTIVO, para poder rotular la salida como «declarada».

    El hueco por planta ya existe y esta vacio: `eje_m` en plantas_indice.json,
    generado hoy todavia con el nombre viejo `module_height` y a null en las
    diez plantas que lo traen.

    Y lo que decide esta cota, medido: NO donde cae el canto respecto a la
    antena -subir el eje sube la banda y la antena a la vez, difraccion
    invariante, 0,00e+0 dB- sino el REBOTE EN EL SUELO, 4,8-5,8 dB por enlace."""
    # CERRADO: EL NOMBRE ES `eje_m`, Y SOLO ESE. Habia dos para la misma cota.
    # `module_height` viene de pvlib, donde significa la altura del MODULO, y
    # aqui se usaba para la del TUBO -lo dice su propia procedencia en
    # `montaje_edm.mjs:133`-: el mismo enredo que `HEJE` en terreno.html.
    #
    # No mueve ningun numero: vale null en las diez plantas que lo traen y
    # nadie lo puebla. Y NO se ignora callando: si llega PUESTO, lanza, porque
    # descartar en silencio la unica medida real de un tubo seria peor.
    m = montaje or {}
    if m.get("module_height") is not None:
        raise ValueError(
            "radio_pv_model: `module_height` ya no se lee; la altura del eje se "
            "declara como `eje_m`. Viene con valor %r, y descartarlo en silencio "
            "perderia una medida." % (m.get("module_height"),))
    v = m.get("eje_m")
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0:
        return {"valor": float(v), "medida": True, "motivo": None}
    if not (defecto_m and defecto_m > 0):
        raise ValueError("radio_pv_model: falta la altura del eje y no hay defecto declarado")
    return {"valor": defecto_m, "medida": False,
            "motivo": "altura_de_eje_declarada_no_medida_en_esta_planta"}


def corta_panel(z_eje, cuerda_m, alpha_deg, wA, wB, zA, zB):
    """Espejo de `cortaPanel()`. EL PANEL DE VERDAD ES UN PLANO INCLINADO.

    `banda()` proyecta el panel como segmento VERTICAL sobre el eje. Para una
    fila lejana da igual; para la fila PROPIA es falso: la antena está a
    0,113 m del eje y el panel llega a ±1,19·cos alfa, diez veces más lejos.

    Con w = distancia perpendicular con signo al eje (positiva hacia el borde
    ALTO), el panel es z(w) = z_eje + w·tan alfa para |w| <= (c/2)·cos alfa, y
    el rayo es otra recta en (w, z). El ángulo de cruce entra solo: quien llama
    pasa wA/wB medidos con la perpendicular a ESA fila.

    El VEREDICTO coincide con el de la banda —comprobado—; lo que NO coincide
    es `wBorde`, la posición del borde difractante: la banda lo pone en w = 0 y
    el panel en w = ±(c/2)·cos alfa."""
    a = alpha_deg * GRADO
    semi_w = (cuerda_m / 2.0) * math.cos(a)
    dw = wB - wA
    if abs(dw) < 1e-12:
        return {"estado": "paralelo", "despeje": None, "borde": None,
                "wBorde": None, "motivo": "enlace_paralelo_a_la_fila"}
    w0, w1 = min(wA, wB), max(wA, wB)
    lo, hi = max(w0, -semi_w), min(w1, semi_w)
    if lo > hi:
        return {"estado": "fuera", "despeje": None, "borde": None,
                "wBorde": None, "motivo": "el_enlace_no_pisa_la_huella"}

    def hueco(w):
        zr = zA + (zB - zA) * ((w - wA) / dw)
        return zr - (z_eje + w * math.tan(a))

    h_lo, h_hi = hueco(lo), hueco(hi)
    # El canto por el que difracta es el que deja MENOS hueco, y el despeje va
    # CON SIGNO respecto a el: mismo convenio que `corta()`. Atravesar se
    # detecta por el CAMBIO DE SIGNO, no por el despeje.
    # FALLO CORREGIDO: la primera version devolvia despeje 0 al tapar, o sea
    # nu = 0 y 6,03 dB fijos tapara lo que tapara.
    cruza = (h_lo > 0) != (h_hi > 0)
    if abs(h_lo) <= abs(h_hi):
        w_b, h = lo, h_lo
    else:
        w_b, h = hi, h_hi
    return {"estado": "tapado" if cruza else ("libre" if h > 0 else "hueco"),
            # MISMO SIGNO QUE `corta()`: positivo = el rayo pasa por FUERA.
            "despeje": -min(abs(h_lo), abs(h_hi)) if cruza else abs(h),
            "borde": z_eje + w_b * math.tan(a), "wBorde": w_b, "motivo": None}


def ancla_antena(radio_m, alpha_deg):
    """Espejo de `anclaAntena()`. El conector de la TCU GIRA CON EL TUBO: no es
    una cota fija. Rotación de (0, −r, 0) alrededor del eje del tubo por −α, o
    sea y' = −r·cos α y z' = +r·sen α.

    Procedencia: anclaje en (tcuX−0,16, −0,225, 0) —Cobertura-Zigbee
    seguidor.js:340, con la X local siendo EL EJE DEL TUBO—, giro
    `makeRotationX(−α)` —terreno.html:1907— y el 3D ya lo dibuja así en `aTip`
    —terreno.html:1925—."""
    a = alpha_deg * GRADO
    return {"dz": -radio_m * math.cos(a), "lateral": radio_m * math.sin(a)}


def altura_antena_tcu(eje_m, radio_m, caida_m, alpha_deg):
    """Espejo de `alturaAntenaTCU()`: anclaje girado, más la caída del coax."""
    return eje_m + ancla_antena(radio_m, alpha_deg)["dz"] - caida_m


def holgura_bajo_modulo(radio_m, caida_m, cuerda_m, alpha_deg):
    """Espejo de `holguraBajoModulo()`. Positivo = la antena cuelga en el hueco;
    negativo = el látigo está DENTRO de la banda que barre su propio panel.

    Cambia de signo en α ≈ 35,1° con cuerda 2,380 m, y los seguidores trabajan
    hasta 55–60°."""
    a = alpha_deg * GRADO
    z_ant = ancla_antena(radio_m, alpha_deg)["dz"] - caida_m
    z_bot = -(cuerda_m / 2.0) * abs(math.sin(a))
    return z_bot - z_ant


def regimen(dx_enlace, dy_enlace, dx_fila, dy_fila, tol_grados=None):
    """Espejo de `regimen()`: pasillo (no cruza filas) o cruza."""
    n1 = math.hypot(dx_enlace, dy_enlace)
    n2 = math.hypot(dx_fila, dy_fila)
    if n1 < 1e-9 or n2 < 1e-9:
        return {"tipo": "degenerado", "anguloDeg": None}
    cos = abs((dx_enlace * dx_fila + dy_enlace * dy_fila) / (n1 * n2))
    ang = math.acos(min(1.0, max(-1.0, cos))) / GRADO
    tol = 10.0 if tol_grados is None else tol_grados
    return {"tipo": "pasillo" if ang <= tol else "cruza", "anguloDeg": ang}


def _fix3(v):
    """`toFixed(3)` de JS, para que los motivos salgan IDENTICOS en los dos."""
    return ("%.3f" % v)


def tierra_lisa(perfil):
    """Espejo de `tierraLisa()`. ITU-R P.1812-6, Anexo 1, Adjunto 1, §5.6.1,
    ecuaciones (85)-(88), mas las cotas modificadas (89)-(91) y el recorte (92).

    Cita verificada contra la implementacion de referencia de la UIT
    (`eeveetza/p1812`, `private/smooth_earth_heights.m`), no de memoria."""
    if not perfil or len(perfil) < 2:
        return None
    n = len(perfil)
    D = perfil[n - 1][0] - perfil[0][0]
    if not (D > 0):
        return None
    # SE CENTRA ANTES DE AJUSTAR y se descentra al final: con cotas absolutas
    # grandes el ajuste pierde precision y el caso PLANO deja de dar cero
    # exacto (medido a 739,23 m: 1,44e-12 dB de residuo). Centrando, el perfil
    # plano tiene cotas CERO exactas y el cero pasa a ser por construccion.
    d_ref, h_ref = perfil[0][0], perfil[0][1]
    v1 = 0.0
    v2 = 0.0
    for i in range(1, n):
        d0 = perfil[i - 1][0] - d_ref
        h0 = perfil[i - 1][1] - h_ref
        d1 = perfil[i][0] - d_ref
        h1 = perfil[i][1] - h_ref
        dd = d1 - d0
        v1 += dd * (h1 + h0)                                         # (85)
        v2 += dd * (h1 * (2 * d1 + d0) + h0 * (d1 + 2 * d0))         # (86)
    hst = (2 * v1 * D - v2) / (D * D)                                # (87)
    hsr = (v2 - v1 * D) / (D * D)                                    # (88)
    h_ini, hNe = 0.0, perfil[n - 1][1] - h_ref
    hobs = -math.inf
    a_obt = -math.inf
    a_obr = -math.inf
    for j in range(1, n - 1):
        dj = perfil[j][0] - d_ref
        HH = (perfil[j][1] - h_ref) - (hst * (D - dj) + hsr * dj) / D
        if HH > hobs:
            hobs = HH                                                # (89a)
        if dj > 0 and HH / dj > a_obt:
            a_obt = HH / dj                                          # (89b)
        if D - dj > 0 and HH / (D - dj) > a_obr:
            a_obr = HH / (D - dj)                                    # (89c)
    if not (hobs > 0):
        hstp, hsrp = hst, hsr                                        # (90a,b)
    else:
        suma = a_obt + a_obr
        gt = 0.5 if suma == 0 else a_obt / suma                      # (90e)
        gr = 0.5 if suma == 0 else a_obr / suma                      # (90f)
        hstp = hst - hobs * gt                                       # (90c)
        hsrp = hsr - hobs * gr                                       # (90d)
    hstd = h_ini if hstp >= h_ini else hstp                          # (91a,b)
    hsrd = hNe if hsrp > hNe else hsrp                               # (91c,d)
    return {"hst": min(hst, h_ini) + h_ref,                          # (92a)
            "hsr": min(hsr, hNe) + h_ref,                            # (92b)
            "hstd": hstd + h_ref, "hsrd": hsrd + h_ref,
            "hobs": None if hobs == -math.inf else hobs,
            "hstBruto": hst + h_ref, "hsrBruto": hsr + h_ref,
            "v1": v1, "v2": v2, "D": D}


def _max_nu(v, izq, der):
    """El maximo ν de toda la recursion de Deygout. Espejo de `maxNu()` del JS.

    `nuMax` es el ν del canto DOMINANTE, que es el criterio del propio Deygout, y
    sale al diccionario porque de el sale el ESTADO del enlace (libre / rozando /
    tapado). Hasta hoy solo existia dentro de la CADENA del motivo cuando el
    dominante despejaba; leerlo de ahi con una expresion regular seria una
    segunda implementacion del criterio, escrita donde menos se mira.

    Se toma el maximo de TODA la recursion y no el del nivel 0: los subtramos van
    contra un rayo auxiliar distinto del directo y sus ν no son comparables
    termino a termino. `None` es «no hay canto que evaluar», NO «despeja».

    MEDIDO sobre el corpus de paneles del banco de paridad (300 casos, 281 con
    ν): la recursion sube el ν en 78 de 281 -el 27,8 %-, hasta +0,7255, y el
    ESTADO no cambia en ninguno."""
    m = v
    if izq and izq.get("nuMax") is not None and izq["nuMax"] > m:
        m = izq["nuMax"]
    if der and der.get("nuMax") is not None and der["nuMax"] > m:
        m = der["nuMax"]
    return m


def difraccion_cantos_detalle(D, zA, zB, cantos, f_hz, prof=0, max_prof=None):
    """Espejo de `difraccionCantosDetalle()`: Deygout sobre cantos sueltos."""
    p = prof or 0
    tope = 3 if max_prof is None else max_prof
    vacio = {"totalDb": 0.0, "dominante": None, "izquierda": None,
             "derecha": None, "profundidad": p, "motivo": None, "nuMax": None}
    if not cantos:
        vacio["motivo"] = "sin cantos"
        return vacio
    if p >= tope:
        vacio["motivo"] = "tope de recursion (%d)" % tope
        return vacio
    if D <= 0:
        vacio["motivo"] = "tramo de longitud nula"
        return vacio
    mejor_v, mejor = -1e9, -1
    for i, c in enumerate(cantos):
        s = c["s"]
        if s <= 0 or s >= D:
            continue
        v = nu(c["z"] - altura_rayo(zA, zB, D, s), s, D - s, f_hz)
        if v > mejor_v:
            mejor_v, mejor = v, i
    if mejor < 0:
        vacio["motivo"] = "ningun canto cae dentro del tramo"
        return vacio
    if mejor_v <= -0.78:
        vacio["motivo"] = "el dominante despeja (nu = %s <= -0,78)" % _fix3(mejor_v)
        vacio["nuMax"] = mejor_v
        return vacio
    s_dom, z_dom = cantos[mejor]["s"], cantos[mejor]["z"]
    perdida_dom = perdida_filo_db(mejor_v)
    izq, der = [], []
    for k, c in enumerate(cantos):
        if k == mejor:
            continue
        if c["s"] < s_dom:
            izq.append({"s": c["s"], "z": c["z"]})
        else:
            der.append({"s": c["s"] - s_dom, "z": c["z"]})
    d_izq = difraccion_cantos_detalle(s_dom, zA, z_dom, izq, f_hz, p + 1, tope)
    d_der = difraccion_cantos_detalle(D - s_dom, z_dom, zB, der, f_hz, p + 1, tope)
    return {"totalDb": perdida_dom + d_izq["totalDb"] + d_der["totalDb"],
            "dominante": {"indice": mejor, "s": s_dom, "z": z_dom,
                          "nu": mejor_v, "perdidaDb": perdida_dom},
            "izquierda": d_izq, "derecha": d_der, "profundidad": p, "motivo": None,
            "nuMax": _max_nu(mejor_v, d_izq, d_der)}


# ══ EL ESTADO DE UN ENLACE: LIBRE / ROZANDO / TAPADO ═══════════════════════
#
# Espejo de `estadoDeNu()` / `peorEstado()` del JS. El mapa deja de pintar dB
# mientras los parametros no esten calibrados —son heredados del modelo
# congelado, `sigma_db` es None y el canal es desconocido, que deja la potencia
# como cota superior con DIECISEIS dB de recorrido— y pinta el ESTADO.
#
# El estado si se sostiene sin calibrar porque sale de ν, que es GEOMETRIA Y
# LONGITUD DE ONDA: no depende de la potencia, ni de la sensibilidad, ni de
# sigma, ni de las correcciones de campana. Un enlace con el primer Fresnel
# despejado lo esta con +19 dBm y con +3.
#
# LOS UMBRALES NO SON NUESTROS:
#   ν <= -0,78      LIBRE    J(ν) = 0 en ITU-R P.526, y es EL MISMO umbral con
#                            el que Deygout corta la recursion aqui arriba.
#                            Equivale a un despeje de 0,55·F1 (c/F1 = -ν/√2).
#   -0,78 < ν <= 0  ROZANDO  el rayo directo pasa e invade el primer Fresnel.
#   ν > 0           TAPADO   el canto corta el rayo directo; J(0) = 6,02 dB.
#
# La regla clasica de 0,6·F1 es ν = -0,85. No se usa: tener dos umbrales de
# despeje en el mismo programa es peor que la diferencia entre ellos.
NU_DESPEJA, NU_ROZA = -0.78, 0


def estado_de_nu(nu_max):
    """`None` es LIBRE de verdad —no hay canto que evaluar—, no «no mirado»."""
    if nu_max is None:
        return "libre"
    if nu_max <= NU_DESPEJA:
        return "libre"
    if nu_max <= NU_ROZA:
        return "rozando"
    return "tapado"


_ORDEN_ESTADO = {"libre": 0, "rozando": 1, "tapado": 2}


def peor_estado(estados):
    """El PEOR de varios. Paneles despejados y terreno delante es TAPADO: manda
    el mecanismo que mas estorba, no la media."""
    peor, n = None, -1
    for e in estados:
        if e is None:
            continue
        if e not in _ORDEN_ESTADO:
            raise ValueError("estado desconocido: %s" % e)
        if _ORDEN_ESTADO[e] > n:
            n, peor = _ORDEN_ESTADO[e], e
    return peor


def bullington_db(D, zA, zB, cantos, f_hz):
    """Espejo de `bullingtonDb()`: UN filo equivalente, sin recursion.

    El terreno va con esto y no con Deygout porque Deygout sobre perfil denso
    da un numero que depende del muestreo (1,10 dB con 2 puntos, 22,74 con 80)
    y del tope de recursion (1,10 con tope 1, 42,81 con tope 6). Medido.

    Es UNA ENVOLTURA de `bullington_detalle`, igual que en JS, para que no haya
    dos construcciones de Bullington que puedan separarse."""
    return bullington_detalle(D, zA, zB, cantos, f_hz)["db"]


def bullington_detalle(D, zA, zB, cantos, f_hz):
    """Espejo de `bullingtonDetalle()`: lo mismo, diciendo ademas DONDE cayo el
    filo equivalente y CON QUE ν se cobro.

    HASTA HOY ESTO NO EXISTIA EN PYTHON: el JS tenia `bullingtonDetalle` desde
    que la medida del repecho local necesito `sB` y `zBull`, y este lado se
    quedo solo con el dB. Una funcion que existe en un motor y no en el otro es
    un trozo de fisica que la paridad NO PUEDE VIGILAR: no es que estuviera mal,
    es que nadie podia saberlo. Va aqui con sus casos en el banco.

        modo   'sin_cantos' | 'ninguno_dentro' | 'directo' | 'obstruido'
               | 'denominador_cero' | 'punto_fuera'
        sB     distancia desde A al filo equivalente, o None
        zBull  cota ABSOLUTA del filo equivalente, o None
        v      el ν con el que se cobro, o None
    """
    nada = {"db": 0.0, "modo": "sin_cantos", "sB": None, "zBull": None, "v": None}
    if not cantos or not (D > 0):
        return nada
    s_tim = -math.inf
    s_tr = (zB - zA) / D
    for c in cantos:
        s = c["s"]
        if not (s > 0) or not (s < D):
            continue
        pend = (c["z"] - zA) / s
        if pend > s_tim:
            s_tim = pend
    if s_tim == -math.inf:                      # ningun canto dentro del vano
        nada["modo"] = "ninguno_dentro"
        return nada
    s_b = None
    z_bull = None
    if s_tim < s_tr:
        # VISION DIRECTA: el filo equivalente es el canto de mayor ν.
        v_max = -math.inf
        for c in cantos:
            s = c["s"]
            if not (s > 0) or not (s < D):
                continue
            w = nu(c["z"] - altura_rayo(zA, zB, D, s), s, D - s, f_hz)
            if w > v_max:
                v_max, s_b, z_bull = w, s, c["z"]
        v = v_max
        modo = "directo"
    else:
        # OBSTRUIDO: el punto de Bullington es donde se cortan las dos rectas de
        # maxima pendiente, una desde cada extremo.
        s_rim = -math.inf
        for c in cantos:
            s = c["s"]
            if not (s > 0) or not (s < D):
                continue
            q = (c["z"] - zB) / (D - s)
            if q > s_rim:
                s_rim = q
        den = s_tim + s_rim
        if not (abs(den) > 1e-12):
            nada["modo"] = "denominador_cero"
            return nada
        s_b = (zB - zA + s_rim * D) / den
        if not (s_b > 0) or not (s_b < D):
            return {"db": 0.0, "modo": "punto_fuera", "sB": None, "zBull": None, "v": None}
        z_bull = zA + s_tim * s_b               # cota del filo equivalente
        v = nu(z_bull - altura_rayo(zA, zB, D, s_b), s_b, D - s_b, f_hz)
        modo = "obstruido"
    return {"db": perdida_filo_db(v) if v > -0.78 else 0.0,
            "modo": modo, "sB": s_b, "zBull": z_bull, "v": v}


def recorta_perfil(perfil, D):
    """Espejo de `recortaPerfil()`: el perfil, recortado AL VANO."""
    if not perfil or len(perfil) < 2 or not (D > 0):
        return None
    d0 = perfil[0][0]
    n = len(perfil)
    # ═══ EL PERFIL LLEGA AL FINAL, CON TOLERANCIA RELATIVA ═══════════════════
    #
    # ESTO ERA `< D` A SECAS, IGUAL QUE EN JS, Y SEGUIA ASI CUANDO EL JS YA
    # ESTABA ARREGLADO. La paridad no lo vio: esta verde porque ningun caso
    # ejercitaba un perfil corto por un ultimo bit, y a nadie se le ocurre
    # escribir ese caso a mano. Es el mismo patron que ya mordio con las
    # geometrias imposibles: paridad verde porque los dos motores fallaban
    # igual, y aqui porque ninguno de los dos se probaba en ese punto.
    #
    # `perfilEntre` construye el perfil sumando nSeg pasos de D/nSeg y esa suma
    # no da D exacto. En la cartera real: 568 de 6.036 enlaces (9,4 %) se
    # quedaban SIN termino de relieve, con motivo «el perfil no cubre el vano»,
    # por un deficit de hasta 2,13e-13 m. Dos decimas de PICOMETRO.
    #
    # La tolerancia no afloja nada: 1e-9 relativo son 0,45 nm en el vano mas
    # largo de la cartera. Un perfil que de verdad no cubre el vano se queda
    # corto en METROS, no en nanometros. Probado a 1 m, 1 mm y 1 um.
    largo = perfil[n - 1][0] - d0
    if largo < D and (D - largo) > 1e-9 * D:
        return None

    def altura(s):
        for i in range(1, n):
            a = perfil[i - 1][0] - d0
            b = perfil[i][0] - d0
            if s <= b:
                if b == a:
                    return perfil[i][1]
                return perfil[i - 1][1] + (perfil[i][1] - perfil[i - 1][1]) * (s - a) / (b - a)
        return perfil[n - 1][1]

    # DOS PUNTOS A 1e-13 SON UN PUNTO. Con la tolerancia puesta, un perfil que
    # acaba en D-1e-13 pasa —y debe pasar— pero su ultimo punto entraria como
    # INTERIOR y encima se anyadiria el de D: dos cantos a 1e-13 y `nu()`
    # dividiendo por esa distancia. Medido en JS: el danyo son 1,07e-14 dB
    # porque en el extremo el rayo va a la altura de la antena, que esta sobre
    # el suelo. Es una cancelacion afortunada, no una garantia, asi que se quita
    # el caso — con el MISMO umbral relativo, para no tener dos criterios de
    # «esto es el mismo punto» en la misma funcion.
    out = [[0, altura(0)]]
    for j in range(n):
        s = perfil[j][0] - d0
        if 0 < s < D and (D - s) > 1e-9 * D:
            out.append([s, perfil[j][1]])
    out.append([D, altura(D)])
    return out


def relieve_delta_db(D, zA, zB, perfil, f_hz):
    """Espejo de `relieveDeltaDb()`: lo que el terreno cobra POR ENCIMA de la
    tierra lisa. Con perfil plano o en rampa sale 0 EXACTO, sin umbral."""
    rec = recorta_perfil(perfil, D)
    if rec is None:
        return None
    perfil = rec
    L = tierra_lisa(perfil)
    if L is None:
        return None
    d0 = perfil[0][0]
    pend = (L["hsr"] - L["hst"]) / L["D"]
    real, liso = [], []
    for punto in perfil:
        s = punto[0] - d0
        if s <= 0 or s >= D:
            continue
        real.append({"s": s, "z": punto[1]})
        liso.append({"s": s, "z": L["hst"] + pend * s})
    ht_e = zA - L["hst"]
    hr_e = zB - L["hsr"]
    # ANTENA BAJO SU PROPIA TIERRA LISA: quien llama ha mezclado alturas
    # absolutas con relativas. Con la ec. (92) puesta, `hst <= h[0]`, asi que
    # `htE >= altura de antena > 0` siempre que `zA` venga en el dato del
    # perfil. Medido: un cerro de 3 m sobre terreno a 739,23 m da 13,3297 dB con
    # el dato bueno y 0,0029 dB con el mezclado -casi cero, indistinguible de
    # llano- con htE = -739,161. Se devuelve `db: None` con motivo, igual que el
    # JS. Ver el comentario largo en `radio_pv_model.js`.
    if not (ht_e > 0) or not (hr_e > 0):
        return {"db": None, "motivo": "antena_bajo_la_tierra_lisa", "bruto": None,
                "real": None, "liso": None, "nuReal": None, "modoReal": None,
                "hst": L["hst"], "hsr": L["hsr"], "hstd": L["hstd"], "hsrd": L["hsrd"],
                "hobs": L["hobs"], "htE": ht_e, "hrE": hr_e}
    # El DETALLE del perfil real, no solo su dB: de su ν sale el ESTADO del
    # enlace frente al terreno, y es el mismo numero con el que ya se cobra.
    # `bullington_db` envuelve a `bullington_detalle`, asi que esto NO cambia ni
    # un bit del relieve. OJO a la diferencia entre `db` y `nuReal`: el relieve
    # es la RESTA contra la tierra lisa y se recorta en cero, asi que un cerro
    # que estorba igual que la referencia sale 0,0 dB; el ν no se resta ni se
    # recorta y dice si el terreno CORTA EL RAYO, que es otra pregunta.
    d_re = bullington_detalle(D, zA, zB, real, f_hz)
    a = d_re["db"]
    b = bullington_db(D, zA, zB, liso, f_hz)
    d = a - b
    return {"db": d if d > 0 else 0.0, "motivo": None, "bruto": d, "real": a, "liso": b,
            "nuReal": d_re["v"], "modoReal": d_re["modo"],
            "hst": L["hst"], "hsr": L["hsr"], "hstd": L["hstd"], "hsrd": L["hsrd"],
            "hobs": L["hobs"], "htE": ht_e, "hrE": hr_e}


# ═══ TECNOLOGÍA ════════════════════════════════════════════════════════════
# Aquí SÍ manda la frecuencia, y por eso `f_hz` es OBLIGATORIO.

C_LUZ = 299792458.0


def exige_f(f_hz):
    """Espejo de `exigeF()`. SIN VALOR POR DEFECTO, a propósito: predecir
    sub-GHz con los números de 2,4 GHz en silencio es el fallo que el encargo
    prohíbe, y un defecto es la forma de cometerlo sin enterarse."""
    if not (f_hz is not None and f_hz > 0):
        raise ValueError("radio_pv_model: falta f_hz. "
                         "La frecuencia no tiene valor por defecto a propósito.")
    return f_hz


def longitud_onda(f_hz):
    return C_LUZ / exige_f(f_hz)


def fspl_db(d_m, f_hz):
    return 20 * math.log10(max(d_m, 1e-3)) + 20 * math.log10(exige_f(f_hz)) - 147.55


def radio_fresnel(d1, d2, f_hz, n=None):
    nn = 1 if n is None else n
    return math.sqrt((nn * longitud_onda(f_hz) * d1 * d2) / (d1 + d2))


def distancia_ruptura(ht, hr, f_hz):
    return (4 * ht * hr) / longitud_onda(f_hz)


# ── DOS RAYOS ──────────────────────────────────────────────────────────────
# Directo más reflejado en el suelo, que es lo que domina un enlace casi
# horizontal a metro y medio del suelo.
#
# LA ARITMÉTICA COMPLEJA VA A MANO, no con el tipo `complex` de Python ni con
# `cmath`. No es purismo: `cmath.sqrt` no hace las mismas operaciones que el
# `cSqrt` del JS, y la paridad se mide en dB. Con el tipo nativo el número
# saldría «parecido», que es justo lo que este fichero existe para no aceptar.

def _cx(re, im=0.0):     return (re, im)
def _cadd(a, b):         return (a[0] + b[0], a[1] + b[1])
def _csub(a, b):         return (a[0] - b[0], a[1] - b[1])
def _cmul(a, b):         return (a[0]*b[0] - a[1]*b[1], a[0]*b[1] + a[1]*b[0])
def _cscale(a, s):       return (a[0] * s, a[1] * s)
def _cabs(a):            return math.hypot(a[0], a[1])


def _cdiv(a, b):
    d = b[0]*b[0] + b[1]*b[1]
    return ((a[0]*b[0] + a[1]*b[1]) / d, (a[1]*b[0] - a[0]*b[1]) / d)


def _csqrt(z):
    r = math.hypot(z[0], z[1])
    re = math.sqrt((r + z[0]) / 2)
    im = math.sqrt((r - z[0]) / 2)
    if z[1] < 0:
        im = -im
    return (re, im)


def _cexp(z):
    e = math.exp(z[0])
    return (e * math.cos(z[1]), e * math.sin(z[1]))


def coef_reflexion(theta, eps_r, sigma, f_hz, pol=None):
    """Coeficiente de reflexión de Fresnel en el suelo. Espejo de `coefReflexion()`.

    eps_r = inf -> CONDUCTOR PERFECTO, Gamma = +1, sin dependencia del ángulo:
    la cota superior del rebote. Sin esto el canon no fallaba, MENTÍA: daba NaN
    y ese NaN viajaba hasta el margen sin que nada lo dijera."""
    if eps_r == math.inf:
        return _cx(1.0, 0.0)
    if not (eps_r > 0):
        raise ValueError("radio_pv_model: epsR inválido (%r). "
                         "Use math.inf para conductor perfecto." % (eps_r,))
    lam = longitud_onda(f_hz)
    eps = _cx(eps_r, -60.0 * lam * sigma)
    s = math.sin(theta)
    cos2 = math.pow(math.cos(theta), 2)
    root = _csqrt(_csub(eps, _cx(cos2, 0)))
    if str("v" if pol is None else pol).lower().find("v") == 0:
        es = _cscale(eps, s)
        return _cdiv(_csub(es, root), _cadd(es, root))
    return _cdiv(_csub(_cx(s, 0), root), _cadd(_cx(s, 0), root))


def dos_rayos_db(d_m, ht, hr, f_hz, eps_r, sigma, pol=None):
    """Espejo de `dosRayosDb()`."""
    exige_f(f_hz)
    d = max(d_m, 1e-3)
    lam = longitud_onda(f_hz)
    d_los = math.hypot(d, ht - hr)
    d_ref = math.hypot(d, ht + hr)
    theta = math.atan2(ht + hr, d)
    gamma = coef_reflexion(theta, eps_r, sigma, f_hz, pol)
    dphi = (2 * math.pi * (d_ref - d_los)) / lam
    refl = _cscale(_cmul(gamma, _cexp(_cx(0, -dphi))), 1 / d_ref)
    campo = _cadd(_cx(1 / d_los, 0), refl)
    return -20 * math.log10((lam / (4 * math.pi)) * _cabs(campo))


def perdida_filo_db(v):
    """Filo de cuchillo, aproximación de ITU-R P.526. Mismo corte en ν = −0,78
    que el modelo congelado."""
    if v <= -0.78:
        return 0.0
    return 6.9 + 20 * math.log10(math.sqrt(math.pow(v - 0.1, 2) + 1) + v - 0.1)


def nu(h_tapa, d1, d2, f_hz):
    """`h_tapa` es cuánto INVADE el obstáculo el rayo: positivo si tapa."""
    if d1 <= 0 or d2 <= 0:
        return -1e9
    return h_tapa * math.sqrt((2 * (d1 + d2)) / (longitud_onda(f_hz) * d1 * d2))


def difraccion_paneles_detalle(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    """Deygout sobre PANELES, que parte en el CANTO y no en el eje. Espejo de
    `difraccionPanelesDetalle()`.

    El cruce lleva su propia geometria -{s, zEje, cuerda, alpha, senPhi}- en vez
    de una banda ya resuelta: `s` es la distancia hasta el EJE de esa fila y
    `senPhi` el seno del angulo enlace-fila. El `w` de cada extremo sale de ahi
    y el canto vuelve a distancia recorrida como s + wBorde/senPhi.

    SE REPARTE POR EL EJE, no por el canto: el canto de cada cruce depende de
    las cotas del tramo, que cambian al recursionar, asi que repartir por el
    daria un reparto distinto en cada nivel. Lo que si va al canto es el punto
    de corte del tramo y la cota desde la que se reconstruye el rayo."""
    p = prof or 0
    tope = 3 if max_prof is None else max_prof
    vacio = {"totalDb": 0.0, "dominante": None, "izquierda": None,
             "derecha": None, "profundidad": p, "motivo": None, "nuMax": None}
    if not cruces:
        vacio["motivo"] = "sin cruces"; return vacio
    if p >= tope:
        vacio["motivo"] = "tope de recursion (%d)" % tope; return vacio
    if D <= 0:
        vacio["motivo"] = "tramo de longitud nula"; return vacio
    mejor_v, mejor, mejor_s, mejor_c = -1e9, -1, 0.0, None
    for i, cr in enumerate(cruces):
        sp = cr["senPhi"]
        if not (sp > 0):
            continue
        c = corta_panel(cr["zEje"], cr["cuerda"], cr["alpha"],
                        -cr["s"] * sp, (D - cr["s"]) * sp, zA, zB)
        if c["wBorde"] is None:
            continue
        s_b = cr["s"] + c["wBorde"] / sp
        if s_b <= 0 or s_b >= D:
            continue
        v = nu(-c["despeje"], s_b, D - s_b, f_hz)
        if v > mejor_v:
            mejor_v, mejor, mejor_s, mejor_c = v, i, s_b, c
    if mejor < 0:
        vacio["motivo"] = "ningun canto cae dentro del tramo"; return vacio
    if mejor_v <= -0.78:
        vacio["motivo"] = "el dominante despeja (nu = %.3f <= -0,78)" % mejor_v
        vacio["nuMax"] = mejor_v
        return vacio
    borde_dom = mejor_c["borde"]
    perdida_dom = perdida_filo_db(mejor_v)
    izq, der = [], []
    for k, cr in enumerate(cruces):
        if k == mejor:
            continue
        if cr["s"] < cruces[mejor]["s"]:
            izq.append(cr)
        else:
            der.append({"s": cr["s"] - mejor_s, "zEje": cr["zEje"],
                        "cuerda": cr["cuerda"], "alpha": cr["alpha"],
                        "senPhi": cr["senPhi"]})
    d_izq = difraccion_paneles_detalle(mejor_s, zA, borde_dom, izq, f_hz, p + 1, tope)
    d_der = difraccion_paneles_detalle(D - mejor_s, borde_dom, zB, der, f_hz, p + 1, tope)
    return {
        "totalDb": perdida_dom + d_izq["totalDb"] + d_der["totalDb"],
        "dominante": {"indice": mejor, "s": mejor_s, "sEje": cruces[mejor]["s"],
                      "nu": mejor_v, "perdidaDb": perdida_dom,
                      "estado": mejor_c["estado"], "despeje": mejor_c["despeje"],
                      "borde": borde_dom, "wBorde": mejor_c["wBorde"]},
        "izquierda": d_izq, "derecha": d_der, "profundidad": p, "motivo": None,
        "nuMax": _max_nu(mejor_v, d_izq, d_der),
    }


def difraccion_paneles_db(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    return difraccion_paneles_detalle(D, zA, zB, cruces, f_hz, prof, max_prof)["totalDb"]


def ganancia_patron_db(elev_rad, patron=None):
    """Espejo de `gananciaPatronDb()`. Diagrama del dipolo de media onda, en dB
    RELATIVOS a su máximo:

        F(e) = cos((pi/2)·sen e) / cos e

    Normalizado a F(0) = 1, así que SOLO RESTA. A 2,45 GHz apenas mueve nada
    —cero exacto en todo el careo, donde las dos antenas van a la misma
    altura—; entra porque una ganancia escalar no se puede llevar a sub-GHz.

    Se aplica POR RAYO, no por enlace: cobertura-rf-fv lo aplica una vez con la
    elevación del rayo directo y luego suma un dos rayos cuyo reflejado sale
    con otro ángulo, lo cual es incoherente con su propio modelo."""
    p = "iso" if patron is None else str(patron)
    if p == "iso":
        return 0.0
    if p != "dipolo":
        raise ValueError("radio_pv_model: patrón de antena «%s» no implementado" % p)
    c = math.cos(elev_rad)
    if abs(c) < 1e-9:
        return -60.0
    f = math.cos((math.pi / 2) * math.sin(elev_rad)) / c
    return 20.0 * math.log10(max(abs(f), 1e-3))


def ganancia_patron_enlace(D, zA, zB, patron=None):
    """Espejo de `gananciaPatronEnlace()`: el patrón aplicado a un enlace.

    EL PATRON ES PAR EN LA ELEVACION. El dipolo vertical da
    `cos((pi/2)*sen t)/cos t`, y sustituir t por -t deja la expresion identica:
    `sen` cambia de signo pero `cos` es par y se lo come, y el `cos t` del
    denominador tambien. El extremo alto y el bajo ven EL MISMO factor, y el
    total del enlace es 2x el de un extremo. No es una aproximacion: es una
    simetria de la formula, y el banco la comprueba.

    Con alturas IGUALES sale 0,000 dB exacto (elevacion 0, el broadside), que
    es por lo que entre dos TCU no se nota; donde si se nota es en TCU->NCU."""
    if not (D > 0):
        return {"elevRad": 0.0, "porExtremoDb": 0.0, "totalDb": 0.0}
    elev = math.atan2(zB - zA, D)
    g = ganancia_patron_db(elev, patron)
    return {"elevRad": elev, "porExtremoDb": g, "totalDb": 2 * g}


def campo_cercano(d1, d2, f_hz, umbral_lambdas=None):
    """Espejo de `campoCercano()`. P.526 supone el obstáculo lejos de los dos
    extremos en longitudes de onda; cerca no hay «filo», hay una antena metida
    debajo de una placa. El corte va en lambdas, NO en `t`: el `t > 0,001` de
    antes es el 0,1 % del enlace, o sea 1,2 cm a 12 m y 33,8 cm a 338."""
    lam = longitud_onda(f_hz)
    u = 2.0 if umbral_lambdas is None else umbral_lambdas
    d = min(d1, d2)
    return {"cerca": d < u * lam, "distanciaM": d, "lambdas": d / lam,
            "umbralLambdas": u}


def vegetacion_db(espesor_m, f_hz, modelo=None):
    """DECLARADA Y NO IMPLEMENTADA, igual que en JS. Devuelve None —no 0 dB—
    sin modelo configurado, para que quien la consuma tenga que decir «no
    modelada» en vez de dar por despejado lo que no se ha mirado."""
    if not modelo:
        return None
    raise ValueError("radio_pv_model: modelo de vegetación «%s» "
                     "no implementado todavía" % modelo)


_VERSION = "fase1"
