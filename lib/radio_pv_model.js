/* radio_pv_model.js — motor de radio para plantas FV. GEOMETRÍA y TECNOLOGÍA
 * separadas, que es la idea entera de este fichero.
 *
 * ┌─ POR QUÉ UNO NUEVO, Y NO UN CAMBIO EN EL DE ANTES ─────────────────────────┐
 * │ `zigbee_pv_model.js` queda CONGELADO byte a byte: lo fija por sha256 el    │
 * │ candado `siting/zigbee_pv_model.lock.json` de SolarGPTfull y lo carea su   │
 * │ `tests/test_paridad_rf_zigbee.py` EJECUTANDO el JS real contra             │
 * │ `factiun_core.rf`, con 0,000000 dB de diferencia. Tocarlo —aunque fuera    │
 * │ para dejar un envoltorio— cambia el sha256 y rompe las dos cosas.          │
 * │ Sigue disponible en la UI como «modelo antiguo (A)», rotulado, para poder  │
 * │ comparar.                                                                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * LA SEPARACIÓN, Y POR QUÉ IMPORTA
 *
 *   GEOMETRÍA   no sabe de radios. Dónde está cada cosa, qué corta el enlace y
 *               a qué altura. Vale igual para Zigbee, LoRa o Wi-SUN, y es lo
 *               ÚNICO que se traslada de una banda a otra.
 *   TECNOLOGÍA  balance, banda, protocolo y regulación. Depende de la radio y
 *               NO se traslada: ni la potencia, ni la sensibilidad, ni una
 *               calibración hecha a 2,4 GHz.
 *
 * UNA SOLA FUNCION DE DESPEJE. El despeje de una fila lo da `cortaPanel` y
 * NADIE MAS. La banda vertical -`banda`/`corta`, que colapsaba el panel sobre
 * el eje- ya no vive aqui: esta en `tests/referencia_banda_vertical.js`, con
 * otro nombre y para carearla. Dos funciones que dan el despeje de una fila es
 * como una se queda vieja sin que nadie lo note, y hay una puerta en la CI que
 * lo impide.
 *
 * SIN SESGO GLOBAL. El modelo antiguo lleva `EL_BURGO_BIAS_DB` para recentrar
 * la predicción sobre lo medido. Aquí no hay. Cuando haya campaña, sus
 * parámetros entran por `radio_params.json` con su versión y su origen, no
 * como un número que empuja el resultado hasta que cuadre.
 *
 * ── ESTADO ──────────────────────────────────────────────────────────────────
 * Fase 1, parte 1 de 2: GEOMETRÍA. La parte de TECNOLOGÍA (banda, Fresnel,
 * dos rayos, difracción, vegetación) viene detrás y consumirá esto.
 */
(function (raiz) {
  "use strict";

  /* ═══ GEOMETRÍA ═══════════════════════════════════════════════════════════
     Nada de aquí abajo sabe en qué frecuencia se emite. Si algo lo necesita,
     está en el sitio equivocado. */

  var GRADO = Math.PI / 180;

  /* LA BANDA, que es el cambio de fondo frente al modelo antiguo.
   *
   * El modelo A trataba cada fila como un FILO DE CUCHILLO a la altura del
   * borde superior del módulo, y ese filo subía DESDE EL SUELO. O sea: un rayo
   * que pasara por debajo del panel se contaba como tapado. Eso es falso y es
   * lo que tumbó el careo contra el 3D: bajo un seguidor hay HUECO, y por ahí
   * pasa señal.
   *
   * Un seguidor inclinado α, con cuerda `c` y eje a altura `eje`, ocupa en
   * vertical una BANDA centrada en el eje:
   *
   *        zTop = eje + (c/2)·|sen α|          ← borde de arriba
   *        zBot = eje − (c/2)·|sen α|          ← borde de abajo
   *
   * y por debajo de `zBot` hay hueco hasta el suelo, SALVO lo que ocupen el
   * tubo de torsión y las hincas, que son estrechos y se tratan aparte.
   *
   * Nótese que con α = 0 (plano) la banda degenera en una línea a la altura
   * del eje: no es que no tape nada, es que tapa un plano horizontal, y para
   * un enlace casi horizontal eso es justo lo que ocurre.
   *
   * `alphaDeg` es el ángulo DE ESE SEGUIDOR en ESE INSTANTE, no uno global:
   * el modelo A usaba un único `#rf-tilt` para toda la planta, y en una planta
   * con backtracking eso no existe ni un solo minuto del día. */
  /* ¿SE METE LA GEOMETRIA BAJO TIERRA? Con el eje a 1,20 m el borde bajo del
   * modulo se acerca al suelo: 1,20 − (c/2)·sen α. A 55° son 0,225 m con cuerda
   * 2,380 y 0,213 con 2,411, o sea que NO toca en el rango de trabajo. Pero con
   * cuerda 2,411 (Fayon) cruza el cero a 84,52°, y el barrido de los bancos
   * llega a 90°. Con 2,380/2,382/2,384 no lo toca nunca: haria falta sen α > 1.
   *
   * Se devuelve el diagnostico, no se corrige: una geometria bajo tierra es un
   * dato malo -o un eje mal declarado-, y taparlo subiendo el borde al suelo
   * daria un numero plausible sobre una planta que no existe. */
  function bajoTierra(ejeM, cuerdaM, alphaDeg, sueloM) {
    var suelo = sueloM == null ? 0 : sueloM;
    var zBot = ejeM - (cuerdaM / 2) * Math.abs(Math.sin(alphaDeg * GRADO));
    var r = suelo === ejeM ? 2 : (ejeM - suelo) / (cuerdaM / 2);
    return {
      zBot: zBot,
      bajoTierra: zBot < suelo,
      hundimientoM: zBot < suelo ? suelo - zBot : 0,
      alphaCorteDeg: r >= 1 ? null : Math.asin(r) / GRADO,
      motivo: zBot < suelo ? "borde_del_modulo_bajo_el_suelo" : null
    };
  }

  /* DÓNDE ESTÁ EL RAYO al llegar a esa banda. Recta entre las dos antenas, en
     el plano vertical que las une. `s` es la distancia recorrida desde A. */
  function alturaRayo(zA, zB, D, s) {
    if (D <= 0) return zA;
    return zA + (zB - zA) * (s / D);
  }

  /* CÓMO CORTA LA BANDA AL RAYO. Tres respuestas posibles, y la diferencia
   * entre ellas es la que el modelo A no sabía dar:
   *
   *   "tapado"  el rayo entra en la banda: hay material delante
   *   "hueco"   el rayo pasa POR DEBAJO de la banda, por el hueco del seguidor
   *   "libre"   el rayo pasa POR ENCIMA
   *
   * Y en los dos últimos casos se devuelve el despeje CON SIGNO respecto al
   * borde que tiene más cerca, que es lo que luego pide la difracción: positivo
   * si el rayo va por fuera de la banda, negativo si va por dentro.
   *
   * OJO al caso "hueco": el borde que cuenta es `zBot`, no el suelo. Un rayo
   * que pasa rozando por debajo del panel está difractando en el BORDE INFERIOR
   * del módulo, no en el terreno. */
  /* ── LA ALTURA DEL EJE DEL TUBO, POR PLANTA ──────────────────────────────
   * NUNCA una constante global escondida. Se pide con el `montaje` de la planta
   * delante, y si la planta no la declara se cae al defecto CON MOTIVO, para
   * que la salida pueda rotularse «declarada» en vez de pasar por medida.
   *
   * El hueco por planta ya existe y está vacío: `montaje.module_height` en
   * `Cobertura-Zigbee/plantas_indice.json` vale `null` en las once, y su
   * generador lo dice — `montaje_edm.mjs:133`, «null · no se ha medido la
   * altura del tubo en ninguna planta».
   *
   * QUÉ DECIDE ESTA COTA, medido y no supuesto: NO decide dónde cae el canto
   * respecto a la antena. Subir el eje sube la banda y la antena a la vez, así
   * que la difracción es invariante por traslación — 0,00e+0 dB entre 1,50 y
   * 2,00 sobre las 49 de El Burgo. Lo que decide es el REBOTE EN EL SUELO:
   * 4,8–5,8 dB por enlace. Y eso la acopla al relieve, no al panel. */
  function alturaEje(montaje, defectoM) {
    /* CERRADO: EL NOMBRE ES `eje_m`, Y SOLO ESE.
       Habia dos para la misma cota y el motor aceptaba los dos «mientras se
       decide». Decidido: `eje_m`, que es el nombre fijado con el estandar.

       `module_height` sale de pvlib, donde significa la altura del MODULO, no
       la del tubo. Aqui se usaba para la del tubo -lo dice su propia cadena de
       procedencia en `montaje_edm.mjs:133`, «no se ha medido la altura del
       TUBO en ninguna planta»-, o sea un nombre prestado que apunta a otra
       cota. Es exactamente el enredo de `HEJE` en `terreno.html`, que decia
       «eje» y era la cara del modulo.

       CAMBIAR ESTO NO MUEVE NINGUN NUMERO, y es comprobable: `module_height`
       vale `null` en las DIEZ plantas de `plantas_indice.json` que lo traen, y
       las otras dos ni lo tienen. Nadie lo puebla y nadie mas lo lee: el unico
       codigo que lo menciona es el generador que lo emite vacio. Asi que antes
       y despues se cae al defecto declarado por el mismo camino.

       Y NO SE IGNORA EN SILENCIO: si alguna planta llega con `module_height`
       PUESTO, esto LANZA. Ignorarlo callando seria peor que aceptarlo — el dia
       que alguien mida un tubo de verdad y lo escriba en el campo viejo, su
       medida se perderia y el mapa saldria con el defecto sin decirlo.

       PENDIENTE, y va aparte a proposito: renombrar el campo en el generador
       (`Cobertura-Zigbee/tools/montaje_edm.mjs`) y regenerar el indice. No
       entra en el PR de comentarios de aquel repo, que declara no tocar codigo. */
    if (montaje && montaje.module_height != null) {
      throw new Error("radio_pv_model: `module_height` ya no se lee; la altura del eje se " +
                      "declara como `eje_m`. Viene con valor " + montaje.module_height +
                      ", y descartarlo en silencio perderia una medida.");
    }
    var v = montaje && montaje.eje_m;
    if (typeof v === "number" && isFinite(v) && v > 0) {
      return { valor: v, medida: true, motivo: null };
    }
    if (!(defectoM > 0)) {
      throw new Error("radio_pv_model: falta la altura del eje y no hay defecto declarado");
    }
    return { valor: defectoM, medida: false,
             motivo: "altura_de_eje_declarada_no_medida_en_esta_planta" };
  }

  /* ── DÓNDE ESTÁ LA ANTENA DE LA TCU ──────────────────────────────────────
   * NO es una cota fija. El conector cuelga del TUBO y GIRA CON ÉL; del
   * conector baja el coax, que cuelga en vertical por su peso. Así que la
   * antena es «anclaje rotado por α, más la caída del coax hacia abajo».
   *
   * PROCEDENCIA, y es geometría de plano, no un supuesto:
   *   · el anclaje está en el marco local del seguidor en (tcuX−0,16, −0,225, 0)
   *     — Cobertura-Zigbee/seguidor.js:340. La X local es EL EJE DEL TUBO
   *     (`tcuX: 1.4`, «TCU desplazada a lo largo del tubo, junto al motor»), así
   *     que lo que cuenta para el giro es el RADIO en el plano perpendicular:
   *     0,225 m por debajo del eje.
   *   · el giro es `makeRotationX(−α)` en ese marco canónico
   *     — Cobertura-Zigbee/terreno.html:1907.
   *   · el coax cuelga 0,50 m — `antHang: 0.50`, seguidor.js:35.
   *   · y el 3D ya lo dibuja así: `aTip = [ax, ay − hang, az]` con (ax,ay,az)
   *     el conector YA rotado — terreno.html:1925. Esta función es esa misma
   *     cuenta, para que el motor y el dibujo no se separen.
   *
   * Rotación de (0, −r, 0) alrededor de X por −α:  y' = −r·cos α, z' = +r·sen α.
   *
   * LA VERTICAL SE MUEVE POCO Y LA LATERAL NO: r·(1−cos α) son 3 cm a 30° y
   * 22,5 a 90°, pero r·sen α son 11 cm a 30°, y ESE es el que decide por qué
   * lado de su propia fila sale el rayo. Ver `holguraBajoModulo`. */
  function anclaAntena(radioM, alphaDeg) {
    var a = alphaDeg * GRADO, r = radioM;
    return { dz: -r * Math.cos(a), lateral: r * Math.sin(a) };
  }

  /* Cota de la antena de la TCU sobre el suelo de SU seguidor. */
  function alturaAntenaTCU(ejeM, radioM, caidaM, alphaDeg) {
    return ejeM + anclaAntena(radioM, alphaDeg).dz - caidaM;
  }

  /* ¿CUELGA LA ANTENA EN EL HUECO DE SU PROPIO MÓDULO, O DENTRO DE LA BANDA?
   *
   * Positivo = cuelga por debajo del borde bajo, en el hueco. Negativo = el
   * látigo está DENTRO de la banda que barre su propio panel, entre el módulo
   * y el suelo.
   *
   * Y esto cambia de signo en operación, que es lo que obliga a tenerlo:
   *
   *     α       antena      borde bajo    holgura
   *     0°      −0,725        0,000       +72,5 cm
   *    30°      −0,695       −0,595       +10,0 cm
   *    45°      −0,659       −0,842       −18,2 cm
   *    55°      −0,629       −0,975       −34,6 cm
   *
   * El cambio de signo está en α ≈ 35,1° con cuerda 2,380 m (34,6° con 2,411),
   * y los seguidores trabajan hasta 55–60°. O sea que «el rayo sale por el
   * hueco de debajo del panel» deja de ser cierto en la mitad alta del
   * recorrido, justo donde el panel más tapa. */
  function holguraBajoModulo(radioM, caidaM, cuerdaM, alphaDeg) {
    var a = alphaDeg * GRADO;
    var zAnt = anclaAntena(radioM, alphaDeg).dz - caidaM;   // respecto al eje
    var zBot = -(cuerdaM / 2) * Math.abs(Math.sin(a));      // idem
    return zBot - zAnt;
  }

  /* ── EL PANEL DE VERDAD: UN PLANO INCLINADO, NO UN SEGMENTO VERTICAL ──────
   *
   * `banda()` proyecta el panel como un segmento VERTICAL sobre el eje de la
   * fila. Para una fila lejana da igual —el rayo la cruza casi en el eje y la
   * huella de ±(c/2)·cos α es pequeña frente al vano—, pero para la fila PROPIA
   * es falso: la antena está a 0,113 m del eje y el panel llega a ±1,19·cos α,
   * o sea DIEZ VECES más lejos. Colapsar eso al eje pone el borde difractante
   * donde no está.
   *
   * AQUÍ SE CORTA CON EL PLANO. En el plano perpendicular a la fila, con
   *
   *     w = distancia perpendicular CON SIGNO al eje, positiva hacia el borde ALTO
   *
   * el panel es el segmento
   *
   *     z(w) = zEje + w·tan α,     |w| ≤ semiW = (c/2)·cos α
   *
   * cuyos extremos están en (±semiW, zEje ± semiZ) con semiZ = (c/2)·sen α.
   * Y el rayo, que también es una recta en (w, z) porque las dos coordenadas
   * son afines en el parámetro del enlace:
   *
   *     zRayo(w) = zA + (zB − zA)·(w − wA)/(wB − wA)
   *
   * EL ÁNGULO DE CRUCE ENTRA SOLO: quien llama pasa `wA`/`wB` medidos con la
   * perpendicular a ESA fila, y la distancia recorrida hasta un `w` es
   * (w − wA)/sen φ. Así que la misma función vale para un enlace perpendicular
   * a la fila y para uno que la corta de refilón.
   *
   * QUÉ DEVUELVE Y POR QUÉ NO ES LO MISMO QUE `corta()`:
   *   · el VEREDICTO (tapado / pasa por debajo / pasa por encima) coincide con
   *     el de la banda, comprobado; lo que NO coincide es
   *   · `wBorde`, la posición del borde por el que difracta. La banda lo pone
   *     en w = 0 y el panel lo pone en w = ±(c/2)·cos α. Para la fila propia
   *     eso cambia d1 de 0,113 m a 1,14 m —de 0,9 λ a 9,3 λ—, y con ello ν y
   *     el veredicto de campo cercano.
   */
  function cortaPanel(zEje, cuerdaM, alphaDeg, wA, wB, zA, zB) {
    var a = alphaDeg * GRADO;
    var semiW = (cuerdaM / 2) * Math.cos(a);
    var semiZ = (cuerdaM / 2) * Math.sin(a);
    var dw = wB - wA;
    if (Math.abs(dw) < 1e-12) {
      /* el enlace va paralelo a la fila: nunca la cruza. No es «libre», es que
         esta fila no es un obstáculo de este enlace. */
      return { estado: "paralelo", despeje: null, borde: null, wBorde: null, motivo: "enlace_paralelo_a_la_fila" };
    }
    /* tramo de `w` que el rayo comparte con la huella del panel */
    var w0 = Math.min(wA, wB), w1 = Math.max(wA, wB);
    var lo = Math.max(w0, -semiW), hi = Math.min(w1, semiW);
    if (lo > hi) {
      return { estado: "fuera", despeje: null, borde: null, wBorde: null, motivo: "el_enlace_no_pisa_la_huella" };
    }
    /* hueco = rayo − panel, afín en w, así que su mínimo está en un extremo */
    function hueco(w) {
      var zR = zA + (zB - zA) * ((w - wA) / dw);
      return zR - (zEje + w * Math.tan(a));
    }
    var hLo = hueco(lo), hHi = hueco(hi);
    /* EL CANTO POR EL QUE DIFRACTA es el que deja MENOS hueco, y el despeje va
       CON SIGNO respecto a él. Mismo convenio que `corta()`: positivo = el rayo
       pasa por fuera, negativo = va por dentro y ése es el fondo que tiene que
       rodear.
       ATRAVESAR el panel se detecta por el CAMBIO DE SIGNO dentro de la huella,
       no por el despeje.
       AQUÍ HUBO UN FALLO MÍO: la primera versión devolvía `despeje: 0` para el
       caso tapado, o sea ν = 0 y 6,03 dB FIJOS tapara lo que tapara. Medido:
       α = 39,07°, 45° y 55° daban los tres 6,03 dB mientras el rayo pasaba a
       7,5, 18,2 y 34,6 cm del canto. Se perdía la profundidad entera. */
    var cruza = (hLo > 0) !== (hHi > 0);
    var wB2 = Math.abs(hLo) <= Math.abs(hHi) ? lo : hi;
    var h = Math.abs(hLo) <= Math.abs(hHi) ? hLo : hHi;
    /* EN LA TANGENCIA EXACTA LA ETIQUETA NO ESTÁ DETERMINADA, y se dice en vez
       de fingir una convención. Justo en la transición de α el rayo roza el
       canto: el despeje es 0 y el signo de `hueco()` en ese extremo depende del
       último bit. NO se le pone un épsilon —sería un umbral inventado— porque
       el NÚMERO es el mismo por los dos lados: despeje 0, luego ν 0 y la misma
       pérdida. Lo único que cambia es la palabra. */
    return {
      estado: cruza ? "tapado" : (h > 0 ? "libre" : "hueco"),
      /* MISMO SIGNO QUE `corta()`: positivo = el rayo pasa por FUERA (libre o
         por el hueco), negativo = va por dentro. Devolver `h` con su signo
         crudo invertia el convenio para el caso «hueco», porque ahi el rayo
         esta por DEBAJO del plano y `z_rayo − z_panel` sale negativo aunque
         el rayo este limpio. Cazado por el banco. */
      despeje: cruza ? -Math.min(Math.abs(hLo), Math.abs(hHi)) : Math.abs(h),
      borde: zEje + wB2 * Math.tan(a),
      wBorde: wB2,
      motivo: null
    };
  }

  /* EL RÉGIMEN DEL ENLACE. Un enlace que va POR EL PASILLO entre dos filas no
   * cruza ninguna, y su física es otra: casi espacio libre con dos rayos. Uno
   * que CRUZA filas se come una banda por cada cruce. Confundirlos es lo que
   * hacía que el mapa de margen pintase el 96 % de El Burgo bajo 0 dB mientras
   * la malla real funcionaba.
   *
   * Se decide por el ángulo del enlace con la dirección de las filas: si es
   * menor que `tolGrados`, va por pasillo. La tolerancia es un parámetro
   * porque depende del ancho del pasillo y del largo del enlace, no una
   * constante universal. */
  function regimen(dxEnlace, dyEnlace, dxFila, dyFila, tolGrados) {
    var n1 = Math.hypot(dxEnlace, dyEnlace), n2 = Math.hypot(dxFila, dyFila);
    if (n1 < 1e-9 || n2 < 1e-9) return { tipo: "degenerado", anguloDeg: null };
    var cos = Math.abs((dxEnlace * dxFila + dyEnlace * dyFila) / (n1 * n2));
    var ang = Math.acos(Math.min(1, Math.max(-1, cos))) / GRADO;   // 0 = paralelo
    var tol = tolGrados == null ? 10 : tolGrados;
    return { tipo: ang <= tol ? "pasillo" : "cruza", anguloDeg: ang };
  }

  /* ═══ EL RELIEVE ═══════════════════════════════════════════════════════════
   *
   * LA TIERRA LISA: la recta de mínimos cuadrados del perfil del vano, que es
   * la superficie de referencia sobre la que «existe» el terreno irregular.
   *
   * CITA VERIFICADA: ITU-R P.1812-6, Anexo 1, Adjunto 1, §5.6.1 «Derivation of
   * smooth-Earth surface», ecuaciones (85)–(88). Comprobada contra la
   * implementación de referencia de la propia UIT -`eeveetza/p1812`,
   * `private/smooth_earth_heights.m`, cuya cabecera dice «smooth-Earth
   * effective antenna heights according to ITU-R P.1812-6»- porque `itu.int`
   * está bloqueado desde aquí y no se cita de memoria lo que no se ha leído.
   *
   * Es un AJUSTE CONTINUO, no por puntos: `v1` y `v2` pesan cada tramo por su
   * longitud, así que un perfil muestreado de forma irregular da la misma recta
   * que el mismo perfil muestreado fino. Comprobado en el banco.
   *
   * POR QUÉ ESTA ECUACIÓN SÍ Y EL RESTO DE P.1812 NO. P.1812 está especificado
   * para vanos de 0,25 a 3.000 km, y los NUESTROS están todos por debajo: los
   * 52 enlaces medidos de El Burgo van de 11,9 a 158,0 m, mediana 24,0 m — los
   * 52 por debajo del suelo de la Recomendación. Su difracción (Bullington +
   * el término empírico `(1−e^(−Luc/6))·(10+0,02·d)` + tierra esférica) está
   * calibrada en ese rango y aquí no aplica. Pero esto de aquí es GEOMETRÍA
   * PURA: una recta de mínimos cuadrados, sin frecuencia, sin distancia
   * calibrada y sin término empírico. No tiene escala, así que vale a 24 m. */
  function tierraLisa(perfil) {
    if (!perfil || perfil.length < 2) return null;
    var n = perfil.length, D = perfil[n - 1][0] - perfil[0][0];
    if (!(D > 0)) return null;
    /* SE CENTRA ANTES DE AJUSTAR, en distancia Y en cota, y se descentra al
       final. No es cosmetica: con cotas absolutas grandes el ajuste pierde
       precision y el caso PLANO deja de dar cero exacto. Medido con un perfil
       plano a 739,23 m -la cota de Ayora-: 1,44e-12 dB de residuo, que con el
       requisito «plano ⇒ 0 exacto» es un fallo. Centrando, las cotas del
       perfil plano son CERO exacto, luego v1 = v2 = 0, luego hst = hsr = 0, y
       al descentrar vuelve la cota original sin haber pasado por ninguna
       resta grande. El cero pasa a ser por construccion, no por suerte. */
    var dRef = perfil[0][0], hRef = perfil[0][1];
    var v1 = 0.0, v2 = 0.0;
    for (var i = 1; i < n; i++) {
      var d0 = perfil[i - 1][0] - dRef, d1 = perfil[i][0] - dRef;
      var h0 = perfil[i - 1][1] - hRef, h1 = perfil[i][1] - hRef, dd = d1 - d0;
      v1 += dd * (h1 + h0);                                            // (85)
      v2 += dd * (h1 * (2 * d1 + d0) + h0 * (d1 + 2 * d0));            // (86)
    }
    var hst = (2 * v1 * D - v2) / (D * D);                             // (87)
    var hsr = (v2 - v1 * D) / (D * D);                                 // (88)
    /* LAS COTAS LISAS MODIFICADAS, ec. (89)-(91). Sin esto la referencia
       ABSORBE el obstaculo: un cerro levanta la recta de minimos cuadrados, la
       referencia sube con el y la diferencia deja de ver el cerro. `gt`/`gr`
       reparten la correccion segun a que extremo cae el obstaculo. */
    var hIni = 0.0, hN = perfil[n - 1][1] - hRef;    // centradas, como hst/hsr
    var hobs = -Infinity, aObT = -Infinity, aObR = -Infinity;
    for (var j = 1; j < n - 1; j++) {
      var dj = perfil[j][0] - dRef;
      var HH = (perfil[j][1] - hRef) - (hst * (D - dj) + hsr * dj) / D;  // terreno menos la recta
      if (HH > hobs) hobs = HH;                                        // (89a)
      if (dj > 0 && HH / dj > aObT) aObT = HH / dj;                    // (89b)
      if (D - dj > 0 && HH / (D - dj) > aObR) aObR = HH / (D - dj);    // (89c)
    }
    var hstp, hsrp;
    if (!(hobs > 0)) { hstp = hst; hsrp = hsr; }                       // (90a,b)
    else {
      var sum = aObT + aObR, gt = sum === 0 ? 0.5 : aObT / sum, gr = sum === 0 ? 0.5 : aObR / sum;
      hstp = hst - hobs * gt;                                          // (90c,e)
      hsrp = hsr - hobs * gr;                                          // (90d,f)
    }
    var hstd = hstp >= hIni ? hIni : hstp;                             // (91a,b)
    var hsrd = hsrp > hN ? hN : hsrp;                                  // (91c,d)
    /* Y EL RECORTE DE (92): la tierra lisa NO puede quedar por encima del
       terreno en los extremos. Sin el, un cerro de 5 m deja la altura de
       antena efectiva en -1,00 m -la antena enterrada en su propia
       referencia- y la difraccion de referencia se dispara. Medido antes de
       ponerlo: el cerro de 5 m daba -5,61 dB y el de 10 m, -12,07. */
    /* Y SE DESCENTRA: todo lo de arriba va en cotas relativas a `hRef`, asi
       que aqui se suma de vuelta. Con el perfil plano, hst = hsr = 0 exactos
       y esto devuelve la cota original sin ninguna resta grande de por medio. */
    return { hst: Math.min(hst, hIni) + hRef,                          // (92a)
             hsr: Math.min(hsr, hN) + hRef,                            // (92b)
             hstd: hstd + hRef, hsrd: hsrd + hRef,
             hobs: hobs === -Infinity ? null : hobs,
             hstBruto: hst + hRef, hsrBruto: hsr + hRef, v1: v1, v2: v2, D: D };
  }

  /* DEYGOUT SOBRE CANTOS SUELTOS. El de paneles resuelve el corte con el plano
   * inclinado por dentro; éste toma los cantos ya resueltos -`{s, z}` con `z`
   * ABSOLUTA- y hace la misma recursión. Es el que necesita el terreno, donde
   * el «canto» es un punto del perfil y no tiene cuerda ni alfa. */
  /* ══ EL ν QUE DECIDE, PUBLICADO COMO CAMPO ════════════════════════════════
   *
   * `nuMax` es el ν del canto DOMINANTE —el criterio del propio Deygout— y sale
   * al objeto porque de él sale el ESTADO del enlace (libre / rozando / tapado),
   * que es lo que el mapa pinta mientras no haya parámetros calibrados.
   *
   * HASTA HOY ESE NUMERO SOLO EXISTIA DENTRO DE UNA CADENA DE TEXTO: cuando el
   * dominante despeja, la función vuelve con `dominante: null` y el ν se va en
   * el motivo, «el dominante despeja (nu = -1,234 <= -0,78)». Sacarlo de ahí con
   * una expresión regular sería una segunda implementación del criterio, escrita
   * en el sitio donde menos se mira. Así que es un campo.
   *
   * SE TOMA EL MAXIMO DE TODA LA RECURSION y no sólo el del nivel 0: en Deygout
   * los subtramos se evalúan contra un rayo AUXILIAR —de la antena al canto
   * dominante—, no contra el directo, así que sus ν no son comparables término a
   * término con el de arriba. Con el máximo, `nuMax` no puede quedarse corto por
   * construcción.
   *
   * MEDIDO sobre el corpus de paneles del banco de paridad (300 casos, 281 con
   * ν): la recursión sube el ν en 78 de 281 —el 27,8 %—, hasta +0,7255. O sea que
   * quedarse con el del nivel 0 declararía más despejados de lo que están a más de
   * uno de cada cuatro. Y el ESTADO no cambia en ninguno: la elección es
   * conservadora y, sobre este corpus, no mueve un solo color.
   *
   * `null` NO significa que despeje: significa que no hay canto que evaluar —el
   * enlace no cruza nada, o ninguno cae dentro del tramo—. Quien llama decide, y
   * eso es distinto de «despeja», que sí es un veredicto. */
  function maxNu(v, izq, der) {
    var m = v;
    if (izq && izq.nuMax != null && izq.nuMax > m) m = izq.nuMax;
    if (der && der.nuMax != null && der.nuMax > m) m = der.nuMax;
    return m;
  }

  function difraccionCantosDetalle(D, zA, zB, cantos, fHz, prof, maxProf) {
    var p = prof || 0, tope = maxProf == null ? 3 : maxProf;
    var vacio = { totalDb: 0.0, dominante: null, izquierda: null, derecha: null,
                  profundidad: p, motivo: null, nuMax: null };
    if (!cantos || !cantos.length) { vacio.motivo = "sin cantos"; return vacio; }
    if (p >= tope) { vacio.motivo = "tope de recursion (" + tope + ")"; return vacio; }
    if (D <= 0) { vacio.motivo = "tramo de longitud nula"; return vacio; }
    var mejorV = -1e9, mejor = -1;
    for (var i = 0; i < cantos.length; i++) {
      var s = cantos[i].s;
      if (s <= 0 || s >= D) continue;
      var v = nu(cantos[i].z - alturaRayo(zA, zB, D, s), s, D - s, fHz);
      if (v > mejorV) { mejorV = v; mejor = i; }
    }
    if (mejor < 0) { vacio.motivo = "ningun canto cae dentro del tramo"; return vacio; }
    if (mejorV <= -0.78) {
      vacio.motivo = "el dominante despeja (nu = " + mejorV.toFixed(3) + " <= -0,78)";
      vacio.nuMax = mejorV;
      return vacio;
    }
    var sDom = cantos[mejor].s, zDom = cantos[mejor].z;
    var perdidaDom = perdidaFiloDb(mejorV);
    var izq = [], der = [];
    for (var k = 0; k < cantos.length; k++) {
      if (k === mejor) continue;
      if (cantos[k].s < sDom) izq.push({ s: cantos[k].s, z: cantos[k].z });
      else der.push({ s: cantos[k].s - sDom, z: cantos[k].z });
    }
    var dIzq = difraccionCantosDetalle(sDom, zA, zDom, izq, fHz, p + 1, tope);
    var dDer = difraccionCantosDetalle(D - sDom, zDom, zB, der, fHz, p + 1, tope);
    return {
      totalDb: perdidaDom + dIzq.totalDb + dDer.totalDb,
      dominante: { indice: mejor, s: sDom, z: zDom, nu: mejorV, perdidaDb: perdidaDom },
      izquierda: dIzq, derecha: dDer, profundidad: p, motivo: null,
      nuMax: maxNu(mejorV, dIzq, dDer)
    };
  }

  /* ══ EL ESTADO DE UN ENLACE: LIBRE / ROZANDO / TAPADO ════════════════════
   *
   * EL MAPA NO PUEDE SEGUIR PINTANDO dB. Los parámetros de radio de este repo
   * son HEREDADOS del modelo congelado, no leídos de un datasheet; `sigma_db`
   * está a `null`; y el canal es desconocido, lo que deja la potencia declarada
   * como cota superior con DIECISEIS dB de recorrido posible. Cinco bandas de
   * color de un margen así presentan como predicción algo que no lo es.
   *
   * El ESTADO sí se sostiene, y por una razón concreta: sale de ν, y ν es
   * GEOMETRIA Y LONGITUD DE ONDA. No depende de la potencia, ni de la
   * sensibilidad, ni de sigma, ni de las correcciones de campaña — que es
   * justamente todo lo que aquí no está calibrado. Un enlace con el primer
   * Fresnel despejado lo está con +19 dBm y con +3.
   *
   * LOS UMBRALES NO SON NUESTROS y no se eligen aquí:
   *
   *   ν <= -0,78   LIBRE     J(ν) = 0 en ITU-R P.526: el filo no cobra nada.
   *                          Es EL MISMO umbral con el que Deygout corta la
   *                          recursión veinte líneas más arriba; poner otro
   *                          número sería tener dos criterios de despeje.
   *                          Equivale a un despeje de 0,55·F1 (c/F1 = -ν/√2).
   *   -0,78 < ν <= 0  ROZANDO   el rayo directo pasa, pero invade la primera
   *                          zona de Fresnel: entre 0 y 6,02 dB de filo.
   *   ν > 0        TAPADO    el canto corta el rayo directo. J(0) = 6,02 dB y
   *                          de ahí para arriba.
   *
   * La regla clásica de ingeniería es 0,6·F1, que en ν es -0,85. NO se usa esa:
   * se usa -0,78 porque es la que el motor ya aplica. La diferencia entre las
   * dos —0,55·F1 contra 0,60·F1— es real pero pequeña, y tener DOS umbrales de
   * despeje en el mismo programa es peor que la diferencia entre ellos.
   *
   * `nuMax == null` es LIBRE de verdad, no «no mirado»: significa que no hay
   * canto que evaluar, o sea que el enlace no cruza nada. Quien no haya podido
   * mirar no llama a esta función: dice que no ha mirado. */
  var NU_DESPEJA = -0.78, NU_ROZA = 0;

  function estadoDeNu(nuMax) {
    if (nuMax == null) return "libre";
    if (nuMax <= NU_DESPEJA) return "libre";
    if (nuMax <= NU_ROZA) return "rozando";
    return "tapado";
  }

  /* El PEOR de varios estados. Un enlace con los paneles despejados y el
     terreno delante está TAPADO: el mecanismo que manda es el que más estorba,
     no la media de los dos. Orden explícito y no alfabético. */
  var ORDEN_ESTADO = { libre: 0, rozando: 1, tapado: 2 };
  function peorEstado(estados) {
    var peor = null, n = -1;
    for (var i = 0; i < estados.length; i++) {
      var e = estados[i];
      if (e == null) continue;
      if (ORDEN_ESTADO[e] == null) throw new Error("estado desconocido: " + e);
      if (ORDEN_ESTADO[e] > n) { n = ORDEN_ESTADO[e]; peor = e; }
    }
    return peor;
  }

  /* BULLINGTON: UN SOLO FILO EQUIVALENTE, y por que el terreno va con este y
   * no con Deygout.
   *
   * NO ES PREFERENCIA, ES MEDIDA. Deygout sobre un perfil de terreno da un
   * numero que NO es una propiedad del terreno. Mismo vano (24 m), misma
   * ondulacion (0,10 m de flecha), variando solo como se muestrea:
   *
   *     2 puntos ->  1,10 dB     20 puntos -> 19,62 dB
   *     4 puntos ->  4,93 dB     40 puntos -> 21,57 dB
   *    10 puntos -> 15,77 dB     80 puntos -> 22,74 dB
   *
   * y variando solo el tope de recursion, con el mismo perfil de 20 puntos:
   *
   *     tope 1 ->  1,10 dB    tope 3 -> 19,62 dB    tope 6 -> 42,81 dB
   *
   * Un modelo cuya salida depende de la densidad de muestreo y de un parametro
   * de ajuste no esta midiendo el terreno. La causa es conocida: Deygout elige
   * un canto DOMINANTE y recursiona, y sobre puntos correlacionados de una
   * superficie continua cada nivel vuelve a cobrar el mismo relieve.
   *
   * Bullington construye UN filo equivalente -la interseccion de las dos rectas
   * de maxima pendiente desde cada extremo- y no recursiona.
   *
   * ESTA LINEA DECIA «asi que es invariante al muestreo», Y ERA DEMASIADO.
   * Medido en `tools/a5_repecho_local.mjs` sobre los 3.040 enlaces de Ayora y
   * San Jose, con el MISMO terreno muestreado a 0,5x y 1x el paso del fichero,
   * Bullington se mueve p95 0,089 dB y hasta 1,259 en el peor; decimando a 4x,
   * hasta 4,169. Es invariante en CONSTRUCCION -no recursiona, cada canto se
   * cobra una vez- pero sus dos rectas de maxima pendiente se leen sobre
   * MUESTRAS, y una muestra puede no caer en la cima.
   *
   * Lo que decide sigue siendo la comparacion, no el valor absoluto:
   * Epstein-Peterson sobre el mismo terreno se mueve p95 5,212 dB, un factor
   * 58. Pero «invariante» no era cierto y el numero lo dice.
   *
   * Y DEYGOUT SE QUEDA PARA LOS PANELES, que es su sitio: alli los cantos son
   * POCOS, DISCRETOS y fisicamente reales -el borde de un modulo-, no muestras
   * de una superficie continua.
   *
   * QUE SE TOMA DE P.1812 Y QUE NO. Se toma la CONSTRUCCION de Bullington
   * (geometria pura). NO se toma su termino empirico `(1−e^(−Luc/6))·(10+0,02·d)`
   * -con d en km-: esta calibrado para vanos de 0,25 a 3.000 km y los 52
   * enlaces medidos de El Burgo van de 11,9 a 158,0 m, los 52 por debajo del
   * suelo de la Recomendacion. Aplicar aqui una correccion de ~10 dB ajustada
   * en otro rango seria inventar. Tampoco se toma la tierra esferica, que a
   * estas distancias es cero y que el motor declara fuera de alcance.
   *
   * `cantos` son `{s, z}` con `z` ABSOLUTA, igual que `difraccionCantosDetalle`. */
  function bullingtonDb(D, zA, zB, cantos, fHz) {
    return bullingtonDetalle(D, zA, zB, cantos, fHz).db;
  }

  /* LO MISMO, DICIENDO ADEMAS DONDE CAYO EL FILO EQUIVALENTE.
     `bullingtonDb` pasa a ser una envoltura de esto para que haya UNA sola
     implementacion: la medida del repecho local necesita `sB` y `zBull`, y
     recalcularlos en el util seria la copia que se separa del original —el
     mismo error que ya mordio con `rfRows` y con las citas por numero de
     linea—. Si esta construccion cambia, cambia para los dos a la vez.
       modo   'sin_cantos' | 'ninguno_dentro' | 'directo' | 'obstruido'
              | 'denominador_cero' | 'punto_fuera'
       sB     distancia desde A al filo equivalente, o null
       zBull  cota ABSOLUTA del filo equivalente, o null
       v      el nu con el que se cobro, o null */
  function bullingtonDetalle(D, zA, zB, cantos, fHz) {
    var nada = { db: 0.0, modo: "sin_cantos", sB: null, zBull: null, v: null };
    if (!cantos || !cantos.length || !(D > 0)) return nada;
    var sTim = -Infinity, sTr = (zB - zA) / D;
    for (var i = 0; i < cantos.length; i++) {
      var s = cantos[i].s;
      if (!(s > 0) || !(s < D)) continue;
      var p = (cantos[i].z - zA) / s;
      if (p > sTim) sTim = p;
    }
    if (sTim === -Infinity) {                        // ningun canto dentro del vano
      nada.modo = "ninguno_dentro"; return nada;
    }
    var v, modo, sB = null, zBull = null;
    if (sTim < sTr) {
      /* VISION DIRECTA: el filo equivalente es el canto de mayor nu. */
      var vMax = -Infinity;
      for (var j = 0; j < cantos.length; j++) {
        var sj = cantos[j].s;
        if (!(sj > 0) || !(sj < D)) continue;
        var w = nu(cantos[j].z - alturaRayo(zA, zB, D, sj), sj, D - sj, fHz);
        if (w > vMax) { vMax = w; sB = sj; zBull = cantos[j].z; }
      }
      v = vMax; modo = "directo";
    } else {
      /* OBSTRUIDO: el punto de Bullington es donde se cortan las dos rectas de
         maxima pendiente, una desde cada extremo. */
      var sRim = -Infinity;
      for (var k = 0; k < cantos.length; k++) {
        var sk = cantos[k].s;
        if (!(sk > 0) || !(sk < D)) continue;
        var q = (cantos[k].z - zB) / (D - sk);
        if (q > sRim) sRim = q;
      }
      var den = sTim + sRim;
      if (!(Math.abs(den) > 1e-12)) { nada.modo = "denominador_cero"; return nada; }
      sB = (zB - zA + sRim * D) / den;
      if (!(sB > 0) || !(sB < D)) {
        return { db: 0.0, modo: "punto_fuera", sB: null, zBull: null, v: null };
      }
      zBull = zA + sTim * sB;                        // cota del filo equivalente
      v = nu(zBull - alturaRayo(zA, zB, D, sB), sB, D - sB, fHz);
      modo = "obstruido";
    }
    return { db: v > -0.78 ? perdidaFiloDb(v) : 0.0,
             modo: modo, sB: sB, zBull: zBull, v: v };
  }

  /* EL RELIEVE, POR DIFERENCIA CONTRA LA TIERRA LISA.
   *
   *     relieveDb  =  Bullington(perfil REAL)  −  Bullington(la RECTA)
   *
   * (ESTA LINEA DECIA «Deygout» HASTA HOY, y el codigo llamaba a Bullington
   * desde que A3 lo cambio. Es la misma podredumbre que las citas por numero
   * de linea: un comentario que describe lo que el codigo hacia ANTES miente
   * con mas autoridad que no tener comentario, porque parece comprobado.)
   *
   * POR QUÉ POR DIFERENCIA Y NO FILTRANDO LO QUE ASOMA. La intención es la
   * misma -que sólo cuente el terreno que sobresale de la referencia- pero
   * filtrar NO FUNCIONA, y está medido:
   *
   *   · de 240 perfiles PLANOS probados, 129 no dan la recta exacta: el ajuste
   *     deja un residuo de hasta 1,6e-11 m por redondeo;
   *   · y un resalte de 1e-11 m sobre la recta NO cuesta 1e-11 dB, cuesta
   *     2,844 dB — porque ν se mide contra el RAYO, no contra el tamaño del
   *     resalte, y con la antena a 0,475 m el suelo plano ya invade la primera
   *     zona de Fresnel.
   *
   * O sea que un filtro «asoma / no asoma» rompería el requisito de «perfil
   * plano ⇒ 0» en más de la mitad de los casos, y lo rompería por dB enteros.
   *
   * La diferencia no necesita umbral: con el perfil plano, las dos
   * difracciones son la MISMA cuenta y se cancelan. Y es el mismo mecanismo
   * que P.1812 usa para lo mismo -su `Lbulla − Lbulls`, la «delta» de
   * delta-Bullington-, que existe justo para quitar el doble conteo entre la
   * difracción y el término de tierra lisa.
   *
   * QUÉ SE TOMA DE P.1812 Y QUÉ NO: se toma la CONSTRUCCIÓN delta (geométrica,
   * sin escala) y la recta de §5.6.1. NO se toma su núcleo de difracción
   * -Bullington con su término empírico y su tierra esférica-, porque está
   * calibrado para 0,25–3.000 km y los 52 enlaces medidos están todos por
   * debajo. El núcleo es el filo de cuchillo de P.526 que este motor ya usa,
   * que es óptica física sin calibrar por distancia, con su guarda de campo
   * cercano aparte (`campoCercano`).
   *
   * ═══ LÍMITE DECLARADO DE ESTE TÉRMINO ════════════════════════════════════
   *
   * UN REPECHO LOCAL CERCA DEL PUNTO DONDE EL RAYO PASA BAJO UN PANEL SE
   * PROMEDIA EN EL CANTO EQUIVALENTE, en vez de resolverse.
   *
   * Medido (`tools/a5_repecho_local.mjs`, Ayora y San José, 3.040 enlaces):
   * pasa en 69 repechos repartidos en 62 enlaces, el 2,0 %. Ahí, resolverlos
   * aparte con Epstein–Peterson cambiaría el relieve 5,0 dB de mediana y 16,4
   * en el p95: el modelo se queda CORTO en ese orden.
   *
   * NO SE CORRIGE, y el motivo está medido, no opinado. Sobre el MISMO terreno,
   * cambiando sólo el paso de muestreo y SIN decimar (0,5× y 1×), E–P se mueve
   * p95 5,2 dB y hasta 21,4 — más que el propio efecto que pretende corregir.
   *
   * Y LA CAUSA NO ERA LA RECURSIÓN, que es lo que se creyó al descartar Deygout
   * (1,10 dB con 2 puntos de perfil, 22,74 con 80). Epstein–Peterson NO
   * recursiona y falla igual. El problema es ENUMERAR MÁXIMOS LOCALES: el
   * número de máximos de una superficie continua muestreada crece con la
   * densidad, así que cualquier método que los cuente hereda la dependencia.
   * La familia entera está cerrada, no sólo Deygout.
   *
   * Delta-Bullington tampoco sirve para esto, y no por inestable: P.1812 ec.
   * (39) es `Ld50 = Lbulla + max(Ldsph − Lbulls, 0)`, la parte `Lbulla − Lbulls`
   * es justo lo que ya se hace aquí, y lo único que añade —`Ldsph`, ec. (27)—
   * NO RECIBE EL PERFIL: sólo distancia, frecuencia, radio terrestre efectivo,
   * alturas de antena efectivas, fracción de mar y polarización. Es un suelo de
   * trayecto, igual para todos los enlaces con la misma (D, f, htE, hrE); no
   * sabe dónde está el repecho, luego no puede resolverlo. (Verificado contra
   * el código del SG3 de la UIT y contra pycraf, no de memoria: itu.int está
   * bloqueado desde este contenedor, así que la cita es de implementaciones de
   * la Recomendación y no del PDF, y eso se dice en vez de disimularlo.)
   *
   * Vale más un límite acotado y dicho que una corrección que depende de cómo
   * se muestreó el terreno. */
  /* RECORTA EL PERFIL AL VANO, interpolando los extremos. Sin esto la recta se
     ajustaba sobre TODO el perfil recibido y no sobre el tramo que el enlace
     recorre: con un perfil de 210 m y un vano de 100, `hsr` salia siendo el
     valor de la recta en 210 m y la altura de antena efectiva daba 1,33 m en
     vez de 0,475. Se cazo corriendo un caso con el perfil mas largo que el
     enlace, que es justo lo que da un DEM muestreado con margen. */
  function recortaPerfil(perfil, D) {
    if (!perfil || perfil.length < 2 || !(D > 0)) return null;
    var d0 = perfil[0][0], n = perfil.length;
    /* ═══ EL PERFIL LLEGA AL FINAL, CON TOLERANCIA RELATIVA ══════════════════
     *
     * Esta comparación era `< D` a secas, y eso RECHAZABA 568 de 6.036 enlaces
     * REALES de la cartera —el 9,4 %, incluidos 65 de Ayora y 275 de San José—
     * diciendo «el perfil no cubre el vano». Era falso: el déficit peor de toda
     * la cartera son 2,13e-13 m. Dos décimas de PICÓMETRO.
     *
     * De dónde sale: `perfilEntre` construye el perfil con `nSeg` pasos de
     * `D/nSeg`, y sumar `nSeg` veces un flotante no da D exacto. El preset
     * calcula su D con `Math.hypot` y el perfil acumula: los dos números
     * difieren en el último bit y el perfil sale "corto".
     *
     * La consecuencia no era un aviso: era que esos enlaces se quedaban SIN
     * TÉRMINO DE RELIEVE, con motivo `relieve_perfil_no_cubre_el_vano`, y eso
     * se lee como «nadie ha mirado el terreno» cuando el terreno estaba ahí.
     * Llevaba así desde que el terreno entró en la app.
     *
     * LA TOLERANCIA NO AFLOJA NADA. 1e-9 relativo son 0,45 nm en el vano más
     * largo de la cartera (447 m) y mil millones de veces más que el defecto
     * observado. Un perfil que de verdad no cubre el vano se queda corto en
     * METROS —le falta un tramo—, no en nanómetros, así que sigue cayendo.
     *
     * Y `altura(s)` ya está preparada: pasado el último punto devuelve su cota,
     * no extrapola. Así que el punto final del recorte sale bien igualmente. */
    var largo = perfil[n - 1][0] - d0;
    if (largo < D && (D - largo) > 1e-9 * D) return null;
    function altura(s) {
      for (var i = 1; i < n; i++) {
        var a = perfil[i - 1][0] - d0, b = perfil[i][0] - d0;
        if (s <= b) {
          if (b === a) return perfil[i][1];
          return perfil[i - 1][1] + (perfil[i][1] - perfil[i - 1][1]) * (s - a) / (b - a);
        }
      }
      return perfil[n - 1][1];
    }
    /* DOS PUNTOS A 1e-13 SON UN PUNTO, y hay que decirlo aquí.
     *
     * Con la tolerancia de arriba, un perfil que acaba en `D − 1e-13` pasa —y
     * debe pasar—. Pero entonces su último punto entra como INTERIOR (s < D) y
     * encima se añade el de `D`: quedan dos cantos separados 1e-13 m, y `nu()`
     * divide por `d2 = 1e-13`.
     *
     * MEDIDO antes de tocar nada: el daño real es 1,07e-14 dB, porque en el
     * extremo el rayo va a la altura de la antena y ésta está sobre el suelo,
     * así que ν sale muy negativo y no cobra. O sea que hoy NO rompe nada.
     *
     * Pero eso es una cancelación afortunada, no una garantía: depende de que
     * la antena esté por encima de su suelo en ese punto. Se quita el caso en
     * vez de confiar en él — con el MISMO umbral relativo que decide si el
     * perfil cubre el vano, para que no haya dos criterios distintos de «esto
     * es el mismo punto» en la misma función. */
    var out = [[0, altura(0)]];
    for (var j = 0; j < n; j++) {
      var s = perfil[j][0] - d0;
      if (s > 0 && s < D && (D - s) > 1e-9 * D) out.push([s, perfil[j][1]]);
    }
    out.push([D, altura(D)]);
    return out;
  }

  function relieveDeltaDb(D, zA, zB, perfil, fHz) {
    var rec = recortaPerfil(perfil, D);
    if (rec === null) return null;
    perfil = rec;
    var L = tierraLisa(perfil);
    if (L === null) return null;
    var d0 = perfil[0][0];
    /* LA REFERENCIA SE EVALUA SOBRE UN PERFIL DE ALTURA CERO CON ALTURAS DE
       ANTENA EFECTIVAS, no sobre la recta inclinada con las alturas absolutas.
       Es como lo hace P.1812 -su `Lbulls` va sobre «a zero-height smooth
       profile with modified antenna heights referred to as effective antenna
       heights»- y NO es un detalle de estilo: lo hice mal primero y se vio
       enseguida. Con las absolutas, un cerro de 5 m levanta la recta a 1,48 m,
       las antenas a 0,475 quedan POR DEBAJO de su propia referencia, la
       referencia cobra mas que el perfil real y el resultado salia NEGATIVO:
       -5,61 dB para el cerro de 5 m, -12,07 para el de 10. Una ganancia por
       tener un cerro delante. */
    /* LA REFERENCIA ES LA RECTA MISMA, con las alturas de antena ABSOLUTAS.
       No un perfil de altura cero con alturas efectivas: eso es lo que hace
       P.1812 y aqui no vale, porque con la recta INCLINADA no se puede reducir
       a cero por traslacion -haria falta un cizallamiento-, y la aproximacion
       que a P.1812 le sirve a nosotros nos rompe la cancelacion exacta.

       Con el recorte de (92) esto esta siempre bien puesto: `hst <= h[0]` y
       `hsr <= h[n-1]`, o sea que la recta queda por debajo de las dos antenas
       en sus extremos, y como recta y rayo son las dos rectas, el rayo queda
       por encima de la recta en TODO el vano. Sin el recorte no: lo probe
       primero sin el y un cerro de 5 m levantaba la recta a 1,48 m con las
       antenas a 0,475, o sea la antena enterrada en su propia referencia. */
    var pend = (L.hsr - L.hst) / L.D;
    var real = [], liso = [];
    for (var i = 0; i < perfil.length; i++) {
      var s = perfil[i][0] - d0;
      if (s <= 0 || s >= D) continue;
      real.push({ s: s, z: perfil[i][1] });
      liso.push({ s: s, z: L.hst + pend * s });
    }
    var htE = zA - L.hst, hrE = zB - L.hsr;      // para los dos rayos, ec. (94)
    /* Y AQUI SE COMPRUEBA, porque el parrafo de arriba es una INVARIANTE y las
       invariantes dependen de quien llama.

       Con (92) puesto, `hst <= h[0]` y `hsr <= h[n-1]`, o sea que la recta pasa
       por debajo del terreno en los dos extremos. Si ademas `zA = h[0] + hAnt`
       con `hAnt > 0` -que es lo que dice el contrato de `presupuesto`: alturas
       ABSOLUTAS, cota del terreno mas antena-, entonces `htE >= hAnt > 0`
       SIEMPRE. Luego `htE <= 0` no es un caso raro de terreno: es que quien
       llama ha mezclado datos.

       Y NO ES TEORICO, ES LA AVERIA QUE MAS BARATO SALE COMETER. Medido con un
       cerro gaussiano de 3 m a media distancia sobre terreno a 739,23 m:

         dato correcto  (zA = suelo + 0,475)   relieve 13,3297 dB, htE = 0,4750
         dato mezclado  (zA = 0,475 a secas)   relieve  0,0029 dB, htE = -739,161

       O sea que el error NO se nota en el resultado: no revienta, no sale
       negativo, no sale enorme. Sale CASI CERO, que es indistinguible de
       «terreno llano», con la antena 739 m bajo tierra. Las dos Bullington
       salen gigantes y casi iguales, y la resta se las come. Un fallo que se
       disfraza del caso bueno tiene que avisar el, porque nadie lo va a ver.

       Se devuelve `db: null` CON MOTIVO y no se lanza: el motor entero esta
       construido sobre decir «no lo se» en vez de inventar, y una excepcion
       aqui tiraria el mapa de la planta entera por un enlace mal pasado. */
    if (!(htE > 0) || !(hrE > 0)) {
      return { db: null, motivo: "antena_bajo_la_tierra_lisa", bruto: null,
               real: null, liso: null, nuReal: null, modoReal: null,
               hst: L.hst, hsr: L.hsr, hstd: L.hstd, hsrd: L.hsrd,
               hobs: L.hobs, htE: htE, hrE: hrE };
    }
    /* EL DETALLE DEL PERFIL REAL, no sólo su dB: de su ν sale el ESTADO del
       enlace frente al terreno, y es el mismo número con el que ya se cobra.
       `bullingtonDb` es una envoltura de `bullingtonDetalle`, así que esto NO
       cambia ni un bit del relieve: cambia lo que se devuelve, no lo que se
       calcula. Se comprueba en `tests/test_terreno_planta.js`.

       OJO A LA DIFERENCIA ENTRE `db` Y `nuReal`: el relieve es la RESTA contra
       la tierra lisa y se recorta en cero, así que un cerro que estorba igual
       que la referencia sale 0,0 dB. El ν no se resta ni se recorta: dice si el
       terreno CORTA EL RAYO, que es otra pregunta y la que el estado contesta.
       Un enlace con el rayo cortado por una loma y relieve 0,0 dB existe, y hoy
       se leía como si no pasara nada. */
    var dRe = bullingtonDetalle(D, zA, zB, real, fHz);
    var a = dRe.db;
    var b = bullingtonDb(D, zA, zB, liso, fHz);
    /* Y SE RECORTA EN CERO. Donde el terreno va POR DEBAJO de la referencia
       -una vaguada- la diferencia sale negativa: el terreno estorba MENOS que
       la tierra lisa. Pero los dos rayos ya calcularon sobre la lisa, asi que
       devolver un numero negativo aqui seria regalar margen por tener un hoyo
       delante. P.1812 recorta igual: `Ld50 = Lbulla + max(Ldsph − Lbulls, 0)`. */
    var d = a - b;
    return { db: d > 0 ? d : 0.0, motivo: null, bruto: d, real: a, liso: b,
             nuReal: dRe.v, modoReal: dRe.modo,
             hst: L.hst, hsr: L.hsr, hstd: L.hstd, hsrd: L.hsrd,
             hobs: L.hobs, htE: htE, hrE: hrE };
  }

  /* ═══ TECNOLOGÍA ══════════════════════════════════════════════════════════
     Aquí SÍ manda la frecuencia, y por eso `fHz` es argumento OBLIGATORIO en
     todo lo de abajo. El modelo antiguo lo lleva con valor por defecto
     (`fHz = 2.45e9`), que es cómodo y es justo como una banda se cuela sin que
     nadie la elija: basta olvidarse del parámetro. Sin defecto, olvidarlo es un
     `NaN` ruidoso en vez de una predicción de 2,4 GHz disfrazada de LoRa.

     LAS FÓRMULAS SON LAS QUE YA USA EL REPO, y se citan en vez de escribirse de
     memoria: salen de `zigbee_pv_model.js`, que está pinchado a 0,000000 dB
     contra `factiun_core.rf` por el banco de paridad de SolarGPTfull. Lo que
     cambia aquí NO es la física del filo: es QUÉ se le da como obstáculo —una
     banda con su hueco en vez de un filo que sube desde el suelo—. */

  var C_LUZ = 299792458;

  function exigeF(fHz) {
    if (!(fHz > 0)) throw new Error("radio_pv_model: falta fHz. La frecuencia no tiene valor por defecto a propósito.");
    return fHz;
  }

  /* λ = c/f. Cita: zigbee_pv_model.js `wavelength`. */
  function longitudOnda(fHz) { return C_LUZ / exigeF(fHz); }

  /* Espacio libre. Cita: zigbee_pv_model.js `fsplDb`, con la constante −147,55
     que es la forma de la fórmula con f en Hz y d en metros. */
  function fsplDb(dM, fHz) {
    return 20 * Math.log10(Math.max(dM, 1e-3)) + 20 * Math.log10(exigeF(fHz)) - 147.55;
  }

  /* Radio de la n-ésima zona de Fresnel. Cita: zigbee_pv_model.js `fresnelRadius`.
     Depende de λ, así que a 868 MHz es ~1,7 veces el de 2,45 GHz: la misma
     geometría despeja MENOS en sub-GHz, y eso es exactamente lo que no se puede
     trasladar de una banda a otra. */
  function radioFresnel(d1, d2, fHz, n) {
    var nn = n == null ? 1 : n;
    return Math.sqrt((nn * longitudOnda(fHz) * d1 * d2) / (d1 + d2));
  }

  /* Punto de ruptura de dos rayos: 4·h1·h2/λ. Cita: zigbee_pv_model.js
     `breakpointDistance`. */
  function distanciaRuptura(ht, hr, fHz) {
    return (4 * ht * hr) / longitudOnda(fHz);
  }

  /* ── DOS RAYOS ───────────────────────────────────────────────────────────
   * Directo más reflejado en el suelo, que es lo que de verdad domina un enlace
   * casi horizontal a metro y medio del suelo. Por debajo del punto de ruptura
   * las dos contribuciones se suman y se restan con la distancia —de ahí los
   * lóbulos—, y por encima el reflejado cancela y la pérdida crece con d⁴.
   *
   * Cita: zigbee_pv_model.js `twoRayPlDb` y `reflectionCoefficient`, con su
   * aritmética compleja mínima copiada OPERACIÓN A OPERACIÓN. No se sustituye
   * por la biblioteca compleja del lenguaje aunque sea más corta: el gemelo
   * Python tiene que dar el mismo número, y `cSqrt` de aquí no es `cmath.sqrt`.
   *
   * Aquí SÍ se le exige `fHz`, a diferencia del original, que lo lleva con
   * defecto 2.45e9 junto con epsR, sigma y pol. */
  function cx(re, im) { return { re: re, im: im || 0 }; }
  function cAdd(a, b) { return cx(a.re + b.re, a.im + b.im); }
  function cSub(a, b) { return cx(a.re - b.re, a.im - b.im); }
  function cMul(a, b) { return cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cScale(a, s) { return cx(a.re * s, a.im * s); }
  function cAbs(a) { return Math.hypot(a.re, a.im); }
  function cDiv(a, b) {
    var d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cSqrt(z) {
    var r = Math.hypot(z.re, z.im);
    var re = Math.sqrt((r + z.re) / 2);
    var im = Math.sqrt((r - z.re) / 2);
    if (z.im < 0) im = -im;
    return cx(re, im);
  }
  function cExp(z) {
    var e = Math.exp(z.re);
    return cx(e * Math.cos(z.im), e * Math.sin(z.im));
  }

  /* Coeficiente de reflexión de Fresnel en el suelo. `pol` "v" o "h". */
  function coefReflexion(theta, epsR, sigma, fHz, pol) {
    /* CONDUCTOR PERFECTO: Γ = +1, sin dependencia del ángulo. Es la cota
       superior del rebote, el caso de referencia que se enseña junto a la
       tierra real. Absorbido de cobertura-rf-fv `reflection_coefficient`, y su
       argumento para tenerlo en el núcleo es el bueno: «evita que cada página
       se escriba su propio dos rayos con suelo perfecto», que es justo la
       avería que la consolidación viene a cerrar.

       Sin esto el canon NO fallaba: MENTÍA EN SILENCIO. Medido ejecutándolo,
       `cSub(eps, cx(cos2,0))` daba Infinity, `cSqrt` lo propagaba y en `cDiv`
       salía Infinity − Infinity = NaN; `dosRayosDb(100, 1.5, 1.5, 2.45e9,
       Infinity, ...)` devolvía NaN y ese NaN viajaba hasta el margen sin que
       nada lo dijera. */
    if (epsR === Infinity) return cx(1.0, 0.0);
    /* Y un epsR que no sea un número LANZA, en vez de propagar NaN. Mismo
       criterio que `exigeF`: olvidarse de un parámetro tiene que hacer ruido. */
    if (!(epsR > 0)) throw new Error("radio_pv_model: epsR inválido (" + epsR + "). Use Infinity para conductor perfecto.");
    var lam = longitudOnda(fHz);
    var eps = cx(epsR, -60.0 * lam * sigma);
    var s = Math.sin(theta);
    var cos2 = Math.pow(Math.cos(theta), 2);
    var root = cSqrt(cSub(eps, cx(cos2, 0)));
    if (String(pol == null ? "v" : pol).toLowerCase().indexOf("v") === 0) {
      var es = cScale(eps, s);
      return cDiv(cSub(es, root), cAdd(es, root));
    }
    return cDiv(cSub(cx(s, 0), root), cAdd(cx(s, 0), root));
  }

  function dosRayosDb(dM, ht, hr, fHz, epsR, sigma, pol) {
    exigeF(fHz);
    var d = Math.max(dM, 1e-3);
    var lam = longitudOnda(fHz);
    var dLos = Math.hypot(d, ht - hr);
    var dRef = Math.hypot(d, ht + hr);
    var theta = Math.atan2(ht + hr, d);
    var gamma = coefReflexion(theta, epsR, sigma, fHz, pol);
    var dphi = (2 * Math.PI * (dRef - dLos)) / lam;
    var refl = cScale(cMul(gamma, cExp(cx(0, -dphi))), 1 / dRef);
    var campo = cAdd(cx(1 / dLos, 0), refl);
    return -20 * Math.log10((lam / (4 * Math.PI)) * cAbs(campo));
  }

  /* Pérdida por filo de cuchillo, aproximación de ITU-R P.526. Cita:
     zigbee_pv_model.js `knifeEdgeLossDb` — misma expresión, mismo corte en
     ν = −0,78. */
  function perdidaFiloDb(v) {
    if (v <= -0.78) return 0.0;
    return 6.9 + 20 * Math.log10(Math.sqrt(Math.pow(v - 0.1, 2) + 1) + v - 0.1);
  }

  /* El parámetro ν de difracción. `hTapa` es cuánto INVADE el obstáculo el rayo:
     positivo si tapa, negativo si hay despeje. Cita: zigbee_pv_model.js `vParam`. */
  function nu(hTapa, d1, d2, fHz) {
    if (d1 <= 0 || d2 <= 0) return -1e9;
    return hTapa * Math.sqrt((2 * (d1 + d2)) / (longitudOnda(fHz) * d1 * d2));
  }

  /* DIFRACCIÓN POR BANDAS, con Deygout. Aquí es donde el cambio de geometría se
   * nota en el número.
   *
   * El modelo antiguo recibe `[[x, cotaSuperior]]` y mide la invasión contra esa
   * cota, con el filo subiendo desde el suelo. Éste recibe BANDAS y le pregunta
   * a `corta()` por el borde que toca: si el rayo va por el hueco, difracta en
   * el borde INFERIOR del módulo; si va por encima, en el superior; y si va
   * dentro, por el más próximo.
   *
   * Deygout: se busca el obstáculo dominante (el de ν mayor), se cobra su
   * pérdida y se repite a los dos lados. `maxProf` acota la recursión igual que
   * en el modelo antiguo (3). */

  /* ── DEYGOUT SOBRE PANELES, QUE ES EL QUE PARTE EN EL CANTO ───────────────
   *
   * El de bandas parte en el EJE de la fila dominante, porque la banda pone el
   * obstáculo ahí. Con el panel real el canto está a ±(c/2)·cos α del eje, y
   * partir en el eje mete un error en d1 y d2 de hasta ese metro largo: para la
   * fila propia eso es la diferencia entre 0,9 λ y 9,3 λ, o sea entre «no se
   * puede calcular» y un número.
   *
   * EL CRUCE LLEVA SU PROPIA GEOMETRÍA, no una banda ya resuelta:
   *
   *     { s, zEje, cuerda, alpha, senPhi }
   *
   * con `s` la distancia recorrida hasta el EJE de esa fila y `senPhi` el seno
   * del ángulo entre el enlace y la fila. De ahí sale todo: el `w` de cada
   * extremo es −s·senφ y (D−s)·senφ, y el canto vuelve a distancia recorrida
   * como s + wBorde/senφ. Así la misma función vale para un enlace
   * perpendicular a la fila y para uno que la corta de refilón.
   *
   * SE PARTE POR EL EJE, NO POR EL CANTO, al repartir los cruces en izquierda y
   * derecha. No es un descuido: el canto de CADA cruce depende de las cotas del
   * tramo, que cambian al recursionar, así que usarlo para repartir daría un
   * reparto distinto en cada nivel. El eje es estable. Lo que sí va al canto es
   * el PUNTO DE CORTE del tramo y la cota desde la que se reconstruye el rayo,
   * que es lo que mueve los números. */
  function difraccionPanelesDetalle(D, zA, zB, cruces, fHz, prof, maxProf) {
    var p = prof || 0, tope = maxProf == null ? 3 : maxProf;
    var vacio = { totalDb: 0.0, dominante: null, izquierda: null, derecha: null,
                  profundidad: p, motivo: null, nuMax: null };
    if (!cruces || !cruces.length) { vacio.motivo = "sin cruces"; return vacio; }
    if (p >= tope) { vacio.motivo = "tope de recursion (" + tope + ")"; return vacio; }
    if (D <= 0) { vacio.motivo = "tramo de longitud nula"; return vacio; }
    var mejorV = -1e9, mejor = -1, mejorS = 0, mejorC = null;
    for (var i = 0; i < cruces.length; i++) {
      var cr = cruces[i], sp = cr.senPhi;
      if (!(sp > 0)) continue;                       // paralelo a la fila: no la cruza
      var c = cortaPanel(cr.zEje, cr.cuerda, cr.alpha, -cr.s * sp, (D - cr.s) * sp, zA, zB);
      if (c.wBorde == null) continue;                // paralelo o fuera de la huella
      var sB = cr.s + c.wBorde / sp;                 // el CANTO, en distancia recorrida
      if (sB <= 0 || sB >= D) continue;
      var v = nu(-c.despeje, sB, D - sB, fHz);       // despeje positivo ⇒ ν negativo
      if (v > mejorV) { mejorV = v; mejor = i; mejorS = sB; mejorC = c; }
    }
    if (mejor < 0) { vacio.motivo = "ningun canto cae dentro del tramo"; return vacio; }
    if (mejorV <= -0.78) {
      vacio.motivo = "el dominante despeja (nu = " + mejorV.toFixed(3) + " <= -0,78)";
      vacio.nuMax = mejorV;
      return vacio;
    }
    var bordeDom = mejorC.borde;
    var perdidaDom = perdidaFiloDb(mejorV);
    var izq = [], der = [];
    for (var k = 0; k < cruces.length; k++) {
      if (k === mejor) continue;
      if (cruces[k].s < cruces[mejor].s) izq.push(cruces[k]);
      else der.push({ s: cruces[k].s - mejorS, zEje: cruces[k].zEje,
                      cuerda: cruces[k].cuerda, alpha: cruces[k].alpha,
                      senPhi: cruces[k].senPhi });
    }
    var dIzq = difraccionPanelesDetalle(mejorS, zA, bordeDom, izq, fHz, p + 1, tope);
    var dDer = difraccionPanelesDetalle(D - mejorS, bordeDom, zB, der, fHz, p + 1, tope);
    return {
      totalDb: perdidaDom + dIzq.totalDb + dDer.totalDb,
      dominante: { indice: mejor, s: mejorS, sEje: cruces[mejor].s, nu: mejorV,
                   perdidaDb: perdidaDom, estado: mejorC.estado,
                   despeje: mejorC.despeje, borde: bordeDom, wBorde: mejorC.wBorde },
      izquierda: dIzq, derecha: dDer, profundidad: p, motivo: null,
      nuMax: maxNu(mejorV, dIzq, dDer)
    };
  }

  function difraccionPanelesDb(D, zA, zB, cruces, fHz, prof, maxProf) {
    return difraccionPanelesDetalle(D, zA, zB, cruces, fHz, prof, maxProf).totalDb;
  }

  /* HAY UNA SOLA IMPLEMENTACIÓN, y devuelve el DETALLE. `difraccionBandasDb`
   * es una envoltura que se queda con el total.
   *
   * El detalle no es un adorno: el panel de perfil tiene que poder señalar cuál
   * fue el obstáculo dominante y cómo se partió el enlace, que es lo que hace
   * entendible el número. Calcularlo por un segundo camino sería tener dos
   * Deygout que se separan solos — el error que este repo ya se ha comido con
   * la física y con el recuento de filas. */
  /* VEGETACIÓN. Declarada y NO implementada, a propósito: el encargo pide un
   * modelo de follaje estándar CITADO y dependiente de la frecuencia, y no se
   * escribe un coeficiente sin tener la recomendación delante (candidata:
   * ITU-R P.833). Con el parámetro a `null` en radio_params.json, esto devuelve
   * `null` —no 0 dB— para que quien lo consuma tenga que decir «no modelada»
   * en vez de dar por despejado lo que no se ha mirado. */
  /* ── PATRÓN DE ANTENA ────────────────────────────────────────────────────
   * La ganancia NO es un escalar. La Jinchang JCW435700RA es un dipolo de ~λ/2
   * —lo dice su propia ficha, citada en cobertura-rf-fv
   * python/zigbee_pv_model.py:270— y un dipolo tiene su máximo en el horizonte
   * y un NULO en su propio eje. Tratar sus 3 dBi como un número suelto es
   * optimista en todo salto con elevación.
   *
   *     F(e) = cos((π/2)·sen e) / cos e ,  e = elevación sobre el horizonte
   *
   * Normalizado a F(0) = 1, así que en el horizonte vale 0 dB y los 3 dBi de
   * catálogo siguen siendo los de catálogo: esto SOLO RESTA, que es lo que
   * tiene que hacer una corrección de patrón sobre la ganancia de pico.
   *
   * POR QUÉ ENTRA AHORA, dicho sin adornarlo: a 2,45 GHz casi no mueve nada.
   * Medido sobre las geometrías reales, 2·gEl vale −0,24 dB en el peor
   * TCU→NCU (12 m) y −1,99 en el peor TCU→HSU (12 m), y CERO EXACTO en todo el
   * careo de El Burgo, donde las dos antenas van a la misma altura. Entra
   * porque `gtx_dbi` como escalar NO SE PUEDE LLEVAR A SUB-GHZ: en LoRa o
   * Wi-SUN la antena es otra, con otro patrón, y hoy no hay dónde declararlo.
   *
   * LO QUE NO MODELA, declarado: el látigo cuelga de la viga y BASCULA con la
   * mesa, así que su eje no es exactamente la vertical. Se toma vertical.
   *
   * Y SE APLICA POR RAYO, no por enlace. cobertura-rf-fv lo aplica una sola vez
   * con la elevación del rayo DIRECTO (python/zigbee_pv_model.py:362) y luego
   * suma un modelo de dos rayos cuyo reflejado sale con OTRO ángulo —a 12 m con
   * antenas a 1,5 m, 14° contra 0°—. Eso es incoherente con el propio modelo al
   * que se suma, así que aquí la función toma la elevación y quien la llama la
   * aplica al rayo que toca. */
  function gananciaPatronDb(elevRad, patron) {
    var p = patron == null ? "iso" : String(patron);
    if (p === "iso") return 0;
    if (p !== "dipolo") throw new Error("radio_pv_model: patrón de antena «" + p + "» no implementado");
    var c = Math.cos(elevRad);
    if (Math.abs(c) < 1e-9) return -60;                 // el nulo del eje, acotado
    var f = Math.cos((Math.PI / 2) * Math.sin(elevRad)) / c;
    return 20 * Math.log10(Math.max(Math.abs(f), 1e-3));
  }

  /* ── LA GANANCIA DE PATRÓN DE UN ENLACE, POR SUS DOS EXTREMOS ────────────
   *
   * `gananciaPatronDb` da el factor del patrón a UNA elevación. Esto lo aplica
   * a un enlace concreto, que es lo que el balance necesita, y existe como
   * función propia por dos razones:
   *
   *   · para que el gemelo de Python tenga la MISMA cuenta y la paridad pueda
   *     vigilarla — hacerla a mano dentro de `presupuesto`, que sólo existe en
   *     JS, la dejaría fuera de todo careo;
   *   · porque la parte que se equivoca no es el patrón, es la ELEVACIÓN.
   *
   * EL PATRÓN ES PAR EN LA ELEVACIÓN. El dipolo vertical da
   * `cos((π/2)·sen θ)/cos θ`, y sustituir θ por −θ deja la expresión idéntica:
   * `sen` cambia de signo, pero `cos` es par y se lo come, y el `cos θ` del
   * denominador también. O sea que el extremo alto y el bajo ven EL MISMO
   * factor, y el total del enlace es 2× el de un extremo. No es una
   * aproximación: es una simetría de la fórmula, y el banco la comprueba.
   *
   * CON ALTURAS IGUALES SALE 0,000 dB EXACTO —elevación 0, que es el
   * broadside—, y por eso a 2,4 GHz entre dos TCU no se nota. Donde sí se nota
   * es en TCU→NCU: 0,505 m contra 3,15 m es una elevación real.
   *
   * `patron` nulo NO es 0 dB en silencio: quien llama recibe `patron: "iso"` y
   * se le anota el motivo. Un cero callado es la forma más barata de mentir. */
  function gananciaPatronEnlace(D, zA, zB, patron) {
    if (!(D > 0)) return { elevRad: 0, porExtremoDb: 0, totalDb: 0 };
    var elev = Math.atan2(zB - zA, D);
    var g = gananciaPatronDb(elev, patron);
    return { elevRad: elev, porExtremoDb: g, totalDb: 2 * g };
  }

  /* ── EL CAMPO CERCANO, QUE ES DONDE EL FILO DE CUCHILLO DEJA DE VALER ─────
   * P.526 supone que el obstáculo está lejos de los dos extremos en longitudes
   * de onda. Cerca no hay «filo»: hay una antena metida debajo de una placa.
   *
   * EL CORTE DE ANTES NO ERA FÍSICO. `rfObstacles` descartaba por `t > 0,001`,
   * o sea el 0,1 % del enlace: 1,2 cm en un salto de 12 m y 33,8 cm en uno de
   * 338. Proporcional al enlace, no a λ.
   *
   * HOY NO SE NOTABA, y conviene saber por qué: los extremos se ponían en el
   * MOTOR, que está sobre el eje de la fila. Medidos 4.676 enlaces en El Burgo,
   * 620 en Ayora, 446 en San José y 3.710 en Páramo: CERO cruces por debajo de
   * 10 λ, y el más próximo a 3,0 m (24 λ), que es el `filaZ` de la bífila.
   *
   * SE NOTA EN CUANTO LA ANTENA SE PONE EN SU SITIO. Con el desplazamiento
   * lateral r·sen α, el enlace cruza el eje de SU PROPIA fila a (r·sen α)/sen φ,
   * con φ el ángulo entre el enlace y la fila:
   *
   *     α      perpendicular      φ=60°       φ=30°
   *    15°      0,058 (0,5 λ)   0,067 (0,5)  0,116 (1,0)
   *    30°      0,112 (0,9 λ)   0,130 (1,1)  0,225 (1,8)
   *    45°      0,159 (1,3 λ)   0,184 (1,5)  0,318 (2,6)
   *
   * O sea DENTRO del campo cercano en todo el recorrido útil. Por eso el corte
   * va en λ y no en `t`, y por eso lo que se devuelve es un ESTADO con motivo y
   * no un número de dB: bajo su propio panel la antena no está difractando en
   * un filo, y fabricar un dB ahí sería inventar. */
  function campoCercano(d1, d2, fHz, umbralLambdas) {
    var lam = longitudOnda(fHz);
    var u = umbralLambdas == null ? 2 : umbralLambdas;
    var d = Math.min(d1, d2);
    return { cerca: d < u * lam, distanciaM: d, lambdas: d / lam, umbralLambdas: u };
  }

  function vegetacionDb(espesorM, fHz, modelo) {
    if (!modelo) return null;
    throw new Error("radio_pv_model: modelo de vegetación «" + modelo + "» no implementado todavía");
  }

  var RadioPV = {
    GRADO: GRADO,
    // geometría
    bajoTierra: bajoTierra,
    alturaRayo: alturaRayo,
    cortaPanel: cortaPanel,
    alturaEje: alturaEje,
    regimen: regimen,
    tierraLisa: tierraLisa,
    difraccionCantosDetalle: difraccionCantosDetalle,
    estadoDeNu: estadoDeNu, peorEstado: peorEstado,
    NU_DESPEJA: NU_DESPEJA, NU_ROZA: NU_ROZA,
    bullingtonDb: bullingtonDb,
    bullingtonDetalle: bullingtonDetalle,
    recortaPerfil: recortaPerfil,
    relieveDeltaDb: relieveDeltaDb,
    anclaAntena: anclaAntena,
    alturaAntenaTCU: alturaAntenaTCU,
    holguraBajoModulo: holguraBajoModulo,
    campoCercano: campoCercano,
    gananciaPatronDb: gananciaPatronDb,
    gananciaPatronEnlace: gananciaPatronEnlace,
    // tecnología
    C_LUZ: C_LUZ,
    longitudOnda: longitudOnda,
    fsplDb: fsplDb,
    radioFresnel: radioFresnel,
    distanciaRuptura: distanciaRuptura,
    perdidaFiloDb: perdidaFiloDb,
    coefReflexion: coefReflexion,
    dosRayosDb: dosRayosDb,
    nu: nu,
    difraccionPanelesDb: difraccionPanelesDb,
    difraccionPanelesDetalle: difraccionPanelesDetalle,
    vegetacionDb: vegetacionDb,
    _version: "fase1"
  };
  raiz.RadioPV = RadioPV;
  /* misma salida doble que el modelo antiguo: la página lo carga con <script> y
     los bancos con require(). */
  if (typeof module !== "undefined" && module.exports) module.exports = RadioPV;
})(typeof window !== "undefined" ? window : globalThis);
