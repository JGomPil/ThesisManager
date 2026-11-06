#!/usr/bin/env python3
"""
Genera los iconos de la aplicación instalable.

POR QUÉ UN GENERADOR Y NO CUATRO PNG SUELTOS
Porque los iconos se piden en cinco tamaños y dos recortes distintos, y a mano
se desincronizan: se cambia el color de la marca y quedan tres iconos nuevos y
dos viejos. Aquí el dibujo está en un sitio, con los colores de `globals.css`.

    python3 scripts/make-icons.py      # reescribe public/

EL DIBUJO es el birrete de `GraduationCap` (Lucide), que es el que ya lleva la
barra superior: un rombo —la tabla vista en perspectiva— y el cuerpo del gorro
debajo, en blanco sobre el azul de la marca.

LOS DOS RECORTES, que es la parte que se suele hacer mal:
  · `any`: el icono tal cual, con su propio margen.
  · `maskable`: Android RECORTA el icono con la forma que decida el fabricante
    (círculo, cuadrado redondeado, gota). Si el dibujo llega al borde, lo
    guillotina. Por eso el maskable lleva el glifo al 56 % y fondo a sangre:
    la «zona segura» es el círculo central del 80 %.
"""
from PIL import Image, ImageDraw

# --- Colores: los mismos que `--primary` de globals.css (hsl 221 83% 53%) ----
AZUL = (37, 99, 235)      # #2563eb
BLANCO = (255, 255, 255)


def birrete(lienzo: ImageDraw.ImageDraw, cx: float, cy: float, ancho: float) -> None:
    """Dibuja el birrete centrado en (cx, cy) con el ancho dado."""
    a = ancho
    # La tabla: un rombo. Más ancho que alto porque se ve en perspectiva.
    lienzo.polygon(
        [(cx, cy - a * 0.30), (cx + a * 0.50, cy - a * 0.05),
         (cx, cy + a * 0.20), (cx - a * 0.50, cy - a * 0.05)],
        fill=BLANCO,
    )
    # El cuerpo del gorro, debajo: un trapecio con las esquinas redondeadas.
    lienzo.polygon(
        [(cx - a * 0.26, cy + a * 0.02), (cx + a * 0.26, cy + a * 0.02),
         (cx + a * 0.22, cy + a * 0.34), (cx - a * 0.22, cy + a * 0.34)],
        fill=BLANCO,
    )
    # El cordón, a la derecha: lo que hace que se reconozca a 32 px.
    lienzo.line(
        [(cx + a * 0.46, cy - a * 0.03), (cx + a * 0.46, cy + a * 0.30)],
        fill=BLANCO, width=max(2, int(a * 0.05)),
    )
    r = max(2, int(a * 0.06))
    lienzo.ellipse(
        [cx + a * 0.46 - r, cy + a * 0.30 - r, cx + a * 0.46 + r, cy + a * 0.30 + r],
        fill=BLANCO,
    )


def icono(lado: int, maskable: bool = False, redondeado: bool = True) -> Image.Image:
    img = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable or not redondeado:
        # A sangre: el recorte lo pone el sistema (Android) o lo redondea él
        # mismo (iOS). Un icono de iOS con transparencia sale con un cuadro
        # negro detrás, así que aquí nunca hay transparencia.
        d.rectangle([0, 0, lado, lado], fill=AZUL)
    else:
        d.rounded_rectangle([0, 0, lado - 1, lado - 1], radius=int(lado * 0.22), fill=AZUL)

    birrete(d, lado / 2, lado / 2, lado * (0.56 if maskable else 0.68))
    return img


if __name__ == '__main__':
    import pathlib
    destino = pathlib.Path(__file__).resolve().parent.parent / 'public'
    destino.mkdir(exist_ok=True)

    salidas = {
        'icon-192.png': icono(192),
        'icon-512.png': icono(512),
        'icon-maskable-512.png': icono(512, maskable=True),
        # iOS no usa el manifest para el icono de la pantalla de inicio: usa
        # `apple-touch-icon`, en PNG y sin transparencia. 180 px es el tamaño
        # que pide el iPhone actual.
        'apple-touch-icon.png': icono(180, redondeado=False),
        'favicon-32.png': icono(32),
    }
    for nombre, img in salidas.items():
        img.save(destino / nombre, 'PNG', optimize=True)
        print(f'  {nombre}  {img.size[0]}x{img.size[1]}')
    print(f'Iconos escritos en {destino}')
