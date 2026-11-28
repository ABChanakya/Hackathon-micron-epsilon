# Offline PDF fonts

The PDF exporter loads these local assets only when a report is requested. There are no CDN or cloud requests. Noto Sans covers Latin/European text; Noto Sans SC, JP and KR cover Chinese, Japanese and Korean. Regular (400) and Bold (700) are real static TrueType faces. Mixed notes use per-script font runs; unrenderable characters produce a visible export error rather than silent missing glyphs. The bundled jsPDF encoder is limited to Basic Multilingual Plane characters; supplementary characters such as U+20BB7 are rejected explicitly even if a font contains the glyph. Font requests time out after 15 seconds and can be retried.

## Sources and licenses

- Noto Sans: official `notofonts/noto-fonts`, commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`, static hinted TTFs.
- Noto Sans CJK: official `notofonts/noto-cjk`, tag `Sans2.004`, commit `523d033d6cb47f4a80c58a35753646f5c3608a78`, region-specific subset variable TTFs. FontTools instancing pins all axes and creates 400/700 static instances; no glyph subsetting or glyph-ID renumbering is performed by this build.
- SIL Open Font License 1.1 is included as `LICENSE-Latin.txt` and `LICENSE-CJK.txt`.
- `manifest.json` records exact source URLs, output SHA-256 hashes and supported Unicode ranges. `../../pdf-font-data.js` is its compact runtime form.

The shipped font assets total approximately 44 MiB. Individual PDFs embed only the used glyphs/fonts and are much smaller. Source downloads are cached in the operating system temporary directory, outside the checkout.

## Rebuild

From `frontend/`, run:

```sh
uv run --with fonttools==4.61.1 python scripts/build-pdf-fonts.py
```

The script fetches only pinned official GitHub sources and regenerates the TTFs, manifest and runtime range table. Review the resulting hashes and run `node --test tests/pdf.test.mjs`. FontTools is a development tool, not a runtime server dependency.
