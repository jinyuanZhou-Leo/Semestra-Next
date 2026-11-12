"""Writes the sample lecture slides the site shows in the file preview (ECE216, Laplace transform).
Run with the API's environment: `uv run --project apps/api python lecture.py <out.pdf>`."""

import sys

import pymupdf

CSS = """
* { font-family: sans-serif; }
h1 { font-size: 30px; margin: 0 0 18px; }
h2 { font-size: 22px; margin: 0 0 14px; color: #0b5d8f; }
p, li { font-size: 15px; line-height: 1.5; }
.eq { font-family: serif; font-size: 15px; margin: 12px 0 12px 24px; }
.muted { color: #666; }
"""

SLIDES = [
    "<h1>ECE216: Signals and Systems</h1><h2>Lecture 9 · The Laplace transform</h2>"
    "<p class='muted'>Week 7 · Prof. Lee · Fall 2026</p>",
    "<h2>1. Why another transform?</h2><ul><li>The Fourier transform needs absolutely "
    "integrable signals.</li><li>Unstable or growing signals still need analysis.</li>"
    "<li>Multiply by a decaying exponential first: s = σ + jω.</li></ul>",
    "<h2>2. Definition</h2><p>The bilateral Laplace transform of x(t):</p>"
    "<p class='eq'>X(s) = ∫ x(t) e<sup>−st</sup> dt</p><p>It exists for s in the "
    "<b>region of convergence</b> (ROC), a vertical strip in the s-plane.</p>",
    "<h2>3. Region of convergence</h2><ul><li>Right-sided signals: ROC to the right of the "
    "rightmost pole.</li><li>Left-sided signals: ROC to the left of the leftmost pole.</li>"
    "<li>Two-sided signals: a strip, or empty.</li></ul>",
    "<h2>4. Common pairs</h2><p class='eq'>e<sup>−at</sup>u(t) ⟷ 1 / (s + a), Re{s} &gt; −a</p>"
    "<p class='eq'>u(t) ⟷ 1 / s, Re{s} &gt; 0</p><p class='eq'>δ(t) ⟷ 1, all s</p>",
    "<h2>5. Properties</h2><ul><li>Linearity</li><li>Time shift: x(t − t₀) ⟷ e<sup>−st₀</sup>X(s)</li>"
    "<li>Differentiation: dx/dt ⟷ sX(s)</li><li>Convolution: x * h ⟷ X(s)H(s)</li></ul>",
    "<h2>6. Transfer functions</h2><p>For an LTI system with impulse response h(t):</p>"
    "<p class='eq'>H(s) = Y(s) / X(s)</p><p>Poles and zeros of H(s) describe stability and "
    "frequency response.</p>",
    "<h2>7. Stability</h2><ul><li>Causal and stable ⟺ all poles in the left half-plane.</li>"
    "<li>The ROC must include the jω-axis.</li></ul>",
    "<h2>8. Summary</h2><ul><li>Definition and ROC</li><li>Transform pairs and properties</li>"
    "<li>Transfer functions and stability</li></ul><p class='muted'>Next: inverse Laplace "
    "transform by partial fractions.</p>",
]

doc = pymupdf.open()
for html in SLIDES:
    page = doc.new_page(width=960, height=540)
    page.insert_htmlbox(pymupdf.Rect(64, 56, 896, 500), html, css=CSS)
doc.set_toc([[1, s.split("</h")[0].split(">")[-1], i + 1] for i, s in enumerate(SLIDES)])
doc.save(sys.argv[1])
