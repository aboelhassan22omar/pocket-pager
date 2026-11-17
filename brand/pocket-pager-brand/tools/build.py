import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = os.path.join(os.path.dirname(__file__), '..', 'svg')
os.makedirs(OUT, exist_ok=True)

C = dict(o1='#FFA024', o2='#FF6A13', o3='#EE4510', amber='#FFB020', o_text='#FF7A1A',
         navy='#0D1324', night='#070A14', ink='#1B1206', cloud='#F5F7FB', mist='#C9D1E3',
         slate='#9AA4B8', steel='#5F6A82', line='#2A3350', cream='#FFF4E6', ready='#22D39A')

MARK = ('<g fill="none" stroke="{c}" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M150 74 q12 26 0 52" stroke-width="9"/><path d="M50 74 q-12 26 0 52" stroke-width="9"/>'
        '<rect x="70" y="42" width="60" height="116" rx="23" stroke-width="9.5"/>'
        '<path d="M87 83 l9 9 l17 -18" stroke-width="10"/></g><circle cx="100" cy="132" r="7.5" fill="{c}"/>')

def mark_at(cx, cy, size, color):
    # mark's native box: 28..172 (144 units) centred on 100,100
    s = size / 144
    return f'<g transform="translate({cx - 100*s:.3f} {cy - 100*s:.3f}) scale({s:.5f})">{MARK.format(c=color)}</g>'

def tile_defs(id_='tg'):
    return (f'<linearGradient id="{id_}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{C["o1"]}"/><stop offset=".52" stop-color="{C["o2"]}"/><stop offset="1" stop-color="{C["o3"]}"/></linearGradient>'
            f'<radialGradient id="{id_}h" cx=".28" cy=".18" r=".6"><stop offset="0" stop-color="#FFD678" stop-opacity=".55"/><stop offset="1" stop-color="#FFD678" stop-opacity="0"/></radialGradient>'
            f'<radialGradient id="{id_}s" cx=".85" cy=".95" r=".7"><stop offset="0" stop-color="#C82800" stop-opacity=".45"/><stop offset="1" stop-color="#C82800" stop-opacity="0"/></radialGradient>')

def tile(x, y, size, radius_ratio=.28, id_='tg', mark_ratio=.66, mark_color='#fff'):
    r = size * radius_ratio
    shape = f'x="{x}" y="{y}" width="{size}" height="{size}" rx="{r:.2f}"'
    return (f'<rect {shape} fill="url(#{id_})"/><rect {shape} fill="url(#{id_}h)"/><rect {shape} fill="url(#{id_}s)"/>'
            + mark_at(x + size/2, y + size/2, size*mark_ratio, mark_color))

def svg(w, h, body, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<defs>{defs}</defs>{body}</svg>\n')

def save(name, s):
    open(f'{OUT}/{name}', 'w').write(s)

# ---------- wordmark outlines (Readex Pro 700, tracking -0.02em) ----------
font = TTFont(os.environ.get('READEX_700', 'ReadexPro-latin-700.ttf'))
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
UPM = font['head'].unitsPerEm
CAP = font['OS/2'].sCapHeight

def outline(text, size, x0, base):
    """returns (path d, advance width) for text at font-size `size`, baseline at `base`"""
    s = size / UPM
    track = -0.02 * UPM
    x = 0
    pen = SVGPathPen(gs)
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, -s, x0 + x*s, base))
        gs[g].draw(tp)
        x += hmtx[g][0] + track
    return pen.getCommands(), (x - track) * s

def wordmark(size, x0, base, c1, c2):
    d1, w1 = outline('Pocket', size, x0, base)
    space = hmtx[cmap[32]][0] * size / UPM * .9
    d2, w2 = outline('Pager', size, x0 + w1 + space, base)
    return f'<path d="{d1}" fill="{c1}"/><path d="{d2}" fill="{c2}"/>', w1 + space + w2

def text_grad(id_, a, b, x1, x2):
    return f'<linearGradient id="{id_}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="0" x2="{x2}" y2="0"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'

# 1) mark only (currentColor, for code / icon fonts)
save('mark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="28 28 144 144">{MARK.format(c="currentColor")}</svg>\n')
for nm, col in [('mark-white.svg', '#fff'), ('mark-orange.svg', C['o2']), ('mark-navy.svg', C['navy'])]:
    save(nm, f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="28 28 144 144">{MARK.format(c=col)}</svg>\n')

# 2) app tile (rounded, transparent corners) + full-bleed square (iOS / Android bg)
save('app-tile.svg', svg(1024, 1024, tile(0, 0, 1024), tile_defs()))
save('app-icon-square.svg', svg(1024, 1024, tile(0, 0, 1024, radius_ratio=0, mark_ratio=.62), tile_defs()))
# maskable / adaptive foreground: mark inside the 66% safe zone
save('app-icon-maskable.svg', svg(1024, 1024, tile(0, 0, 1024, radius_ratio=0, mark_ratio=.5), tile_defs()))
save('android-foreground.svg', svg(1024, 1024, mark_at(512, 512, 1024*.5, '#fff')))
save('android-background.svg', svg(1024, 1024, tile(0, 0, 1024, radius_ratio=0, mark_ratio=0.0001, mark_color='none'), tile_defs()))
save('favicon.svg', svg(64, 64, tile(0, 0, 64, radius_ratio=.24, mark_ratio=.78), tile_defs()))

# 3) wordmarks
H = 200; FS = 150; BASE = 100 + CAP*FS/UPM/2
for nm, c1, grad, bg in [
    ('wordmark-on-dark.svg', C['cloud'], (C['o_text'], C['amber']), None),
    ('wordmark-on-light.svg', C['navy'], (C['o3'], C['o2']), None),
    ('wordmark-on-orange.svg', '#fff', None, None)]:
    _, w = wordmark(FS, 0, BASE, '#000', '#000')
    W = int(w) + 8
    defs = text_grad('wg', grad[0], grad[1], 0, W) if grad else ''
    body, _ = wordmark(FS, 4, BASE, c1, 'url(#wg)' if grad else C['ink'])
    save(nm, svg(W, H, body, defs))

# 4) horizontal lockups (tile + wordmark), transparent background
def lockup(c1, grad, h=240):
    t = h
    fs = h * .5
    base = h/2 + CAP*fs/UPM/2
    gap = h * .28
    _, w = wordmark(fs, 0, base, '#000', '#000')
    W = int(t + gap + w + 8)
    defs = tile_defs() + (text_grad('wg', grad[0], grad[1], t + gap, W) if grad else '')
    body = tile(0, 0, t) + wordmark(fs, t + gap, base, c1, 'url(#wg)' if grad else C['ink'])[0]
    return W, h, body, defs

for nm, c1, grad in [('lockup-on-dark.svg', C['cloud'], (C['o_text'], C['amber'])),
                     ('lockup-on-light.svg', C['navy'], (C['o3'], C['o2']))]:
    W, h, body, defs = lockup(c1, grad)
    save(nm, svg(W, h, body, defs))

# 5) stacked lockup with Arabic tagline (text kept as text: needs Readex Pro)
def stacked(bgfill, c1, grad, tagc, W=1200, H=1200, defs_extra=''):
    t = 420
    fs = 150
    _, w = wordmark(fs, 0, 0, '#000', '#000')
    x0 = (W - w) / 2
    base = 760
    defs = tile_defs() + (text_grad('wg', grad[0], grad[1], x0, x0 + w) if grad else '') + defs_extra
    body = (bgfill + tile((W - t)/2, 160, t) + wordmark(fs, x0, base, c1, 'url(#wg)' if grad else C['ink'])[0]
            + f'<text x="{W/2}" y="880" text-anchor="middle" direction="rtl" font-family="Readex Pro" font-weight="700" font-size="64" fill="{tagc}">طلبك جاهز في جيبك</text>'
            + f'<text x="{W/2}" y="1070" text-anchor="middle" font-family="Readex Pro" font-weight="700" font-size="28" letter-spacing="7" fill="{tagc}" fill-opacity=".7">POWERED BY AUREXIS</text>')
    return svg(W, H, body, defs)

save('stacked-dark.svg', stacked(f'<rect width="1200" height="1200" fill="{C["navy"]}"/>', C['cloud'], (C['o_text'], C['amber']), C['mist']))
save('stacked-light.svg', stacked(f'<rect width="1200" height="1200" fill="{C["cream"]}"/>', C['navy'], (C['o3'], C['o2']), C['steel']))

# 6) Open Graph / social share 1200x630
def og():
    W, H = 1200, 630
    bg = (f'<rect width="{W}" height="{H}" fill="{C["navy"]}"/>'
          f'<rect width="{W}" height="{H}" fill="url(#glow)"/>')
    glow = '<radialGradient id="glow" cx=".82" cy=".1" r=".7"><stop offset="0" stop-color="#FF6A13" stop-opacity=".35"/><stop offset="1" stop-color="#FF6A13" stop-opacity="0"/></radialGradient>'
    fs = 112
    _, w = wordmark(fs, 0, 0, '#000', '#000')
    x0 = (W - w) / 2
    defs = tile_defs() + glow + text_grad('wg', C['o_text'], C['amber'], x0, x0 + w)
    body = (bg + tile((W - 200)/2, 70, 200) + wordmark(fs, x0, 400, C['cloud'], 'url(#wg)')[0]
            + f'<text x="{W/2}" y="490" text-anchor="middle" direction="rtl" font-family="Readex Pro" font-weight="700" font-size="52" fill="{C["mist"]}">طلبك جاهز في جيبك — من غير أي تطبيق</text>'
            + f'<text x="{W/2}" y="575" text-anchor="middle" font-family="Readex Pro" font-weight="700" font-size="22" letter-spacing="6" fill="{C["steel"]}">POWERED BY AUREXIS</text>')
    return svg(W, H, body, defs)
save('og-image.svg', og())
print('ok', sorted(os.listdir(OUT)))
