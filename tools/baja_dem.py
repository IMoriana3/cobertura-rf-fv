#!/usr/bin/env python3
"""REGENERA tests/fixtures/dem_<planta>.json DESDE EL CDN. Pide red; no corre en CI.

    python3 tools/baja_dem.py ayora
    python3 tools/baja_dem.py sanjose

POR QUE UNA REJILLA Y NO LAS TESELAS. El encuadre de Ayora son 25 teselas a
zoom 15: unos 2 MB. Versionar eso para leer 1.500 puntos no compensa (se acaba
de cortar un .glb de 4,4 MB del banco por ese mismo motivo). Se guarda una
rejilla de 30 m —el paso REAL del dato de origen, que es SRTM/ASTER; el raster
de la tesela va mas fino pero no lleva mas informacion— con su procedencia.

Vale para cualquier planta con levantamiento (`CON_COTAS` en index.html).

El formato es el mismo que `<planta>_relieve.json` del visor: x0/n0/paso/nx/nn
y `z` en fila mayor. Asi el careo interpola igual que la pagina.
"""
import json, math, os, sys, urllib.request, zlib, struct

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESELA = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
PASO = 30.0          # metros: el paso del dato de origen
MARGEN = 300.0       # el mismo que usa cargaDEM en index.html

def lon2tx(lon, z): return (lon + 180) / 360 * 2 ** z
def lat2ty(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z

def png_rgb(buf):
    """PNG de 8 bits RGB sin entrelazar -> (w, h, bytes). Sin dependencias."""
    assert buf[:8] == b"\x89PNG\r\n\x1a\n", "no es un PNG"
    i, idat, w = 8, b"", None
    while i < len(buf):
        ln = struct.unpack(">I", buf[i:i+4])[0]; tipo = buf[i+4:i+8]; dat = buf[i+8:i+8+ln]
        if tipo == b"IHDR":
            w, h, prof, color = struct.unpack(">IIBB", dat[:10])
            assert prof == 8 and color == 2 and dat[12] == 0, "se espera RGB de 8 bits sin entrelazar"
        elif tipo == b"IDAT": idat += dat
        elif tipo == b"IEND": break
        i += 12 + ln
    cru = zlib.decompress(idat); out = bytearray(w * h * 3); fila = w * 3; prev = bytearray(fila); p = 0
    for j in range(h):
        f = cru[p]; p += 1; lin = bytearray(cru[p:p+fila]); p += fila
        for k in range(fila):
            a = lin[k-3] if k >= 3 else 0; b = prev[k]; c = prev[k-3] if k >= 3 else 0
            if f == 1: lin[k] = (lin[k] + a) & 255
            elif f == 2: lin[k] = (lin[k] + b) & 255
            elif f == 3: lin[k] = (lin[k] + (a + b) // 2) & 255
            elif f == 4:
                q = a + b - c; pa, pb, pc = abs(q-a), abs(q-b), abs(q-c)
                lin[k] = (lin[k] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[j*fila:(j+1)*fila] = lin; prev = lin
    return w, h, bytes(out)

def main():
    pl = sys.argv[1] if len(sys.argv) > 1 else "ayora"
    lay = json.load(open(os.path.join(RAIZ, "plantas", pl + "_layout.json")))
    pts = lay["trackers"] + lay.get("ncus", []) + lay.get("meteo", [])
    x0 = min(q["x"] for q in pts) - MARGEN; x1 = max(q["x"] for q in pts) + MARGEN
    n0 = min(q["n"] for q in pts) - MARGEN; n1 = max(q["n"] for q in pts) + MARGEN
    clat, clon = lay["clat"], lay["clon"]
    mLat = 111320.0; mLon = 111320.0 * math.cos(math.radians(clat))
    lat = lambda n: clat + n / mLat; lon = lambda x: clon + x / mLon
    z = 15 if max(x1 - x0, n1 - n0) > 1500 else 14
    txmin, txmax = math.floor(lon2tx(lon(x0), z)), math.floor(lon2tx(lon(x1), z))
    tymin, tymax = math.floor(lat2ty(lat(n1), z)), math.floor(lat2ty(lat(n0), z))
    W = (txmax - txmin + 1) * 256; H = (tymax - tymin + 1) * 256
    print(f"zoom {z} · teselas x {txmin}..{txmax} y {tymin}..{tymax} ({(txmax-txmin+1)*(tymax-tymin+1)})")
    mosaico = bytearray(W * H * 3); bajadas = 0
    for tx in range(txmin, txmax + 1):
        for ty in range(tymin, tymax + 1):
            u = TESELA.format(z=z, x=tx, y=ty)
            with urllib.request.urlopen(u, timeout=60) as r: buf = r.read()
            tw, th, px = png_rgb(buf); assert (tw, th) == (256, 256), u
            ox, oy = (tx - txmin) * 256, (ty - tymin) * 256
            for j in range(256):
                d = ((oy + j) * W + ox) * 3
                mosaico[d:d + 256*3] = px[j*256*3:(j+1)*256*3]
            bajadas += 1
            print(f"\r  {bajadas} teselas", end="", flush=True)
    print()
    def cota(la, lo):   # bilineal, igual que cargaDEM
        fx = min(max((lon2tx(lo, z) - txmin) * 256, 0), W - 1)
        fy = min(max((lat2ty(la, z) - tymin) * 256, 0), H - 1)
        ax, ay = int(fx), int(fy); bx, by = min(W-1, ax+1), min(H-1, ay+1)
        tx_, ty_ = fx - ax, fy - ay
        g = lambda ix, iy: (mosaico[(iy*W+ix)*3]*256 + mosaico[(iy*W+ix)*3+1] + mosaico[(iy*W+ix)*3+2]/256)
        return ((g(ax,ay)*(1-tx_)+g(bx,ay)*tx_)*(1-ty_) + (g(ax,by)*(1-tx_)+g(bx,by)*tx_)*ty_) - 32768
    nx = int((x1 - x0) / PASO) + 1; nn = int((n1 - n0) / PASO) + 1
    zs = [round(cota(lat(n0 + j*PASO), lon(x0 + i*PASO)), 2) for j in range(nn) for i in range(nx)]
    out = {"planta": pl, "fuente": "Terrarium (elevation-tiles-prod), zoom %d" % z,
           "url": TESELA, "teselas": bajadas, "paso": PASO,
           "x0": round(x0, 3), "n0": round(n0, 3), "nx": nx, "nn": nn,
           "nota": ("cotas m.s.n.m. sobre la rejilla local de la planta (x este, n norte), "
                    "bilineal sobre el mosaico de teselas. Regenerar con tools/baja_dem.py."),
           "z": zs}
    dst = os.path.join(RAIZ, "tests", "fixtures", "dem_%s.json" % pl)
    json.dump(out, open(dst, "w"), separators=(",", ":"))
    print(f"{nx}x{nn} = {len(zs)} cotas · {os.path.getsize(dst)/1024:.0f} KB -> {os.path.relpath(dst, RAIZ)}")
    print(f"rango {min(zs):.1f} .. {max(zs):.1f} m")

main()
