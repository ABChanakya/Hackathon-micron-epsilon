"""Build a full-text (BM25) index of the Micro-Epsilon docs.  Usage: python3 -I build.py [--all]
Default scope: EN manuals + datasheets + MEDAQLib docs. --all adds DE manuals and Setup Guides."""
import os, re, sqlite3, subprocess, sys, time, zipfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PI = os.path.join(ROOT, "productinformation")
EXTRA = os.path.join(HERE, "extra_docs")
DB = os.path.join(HERE, "index.db")


def pdfs(everything):
    # MEDAQLib reference docs live inside the Linux SDK zip
    os.makedirs(EXTRA, exist_ok=True)
    with zipfile.ZipFile(os.path.join(ROOT, "software", "MEDAQLib-5.6.1.414-Linux.zip")) as z:
        for n in z.namelist():
            if n.lower().endswith(".pdf"):
                out = os.path.join(EXTRA, "MEDAQLib_" + os.path.basename(n))
                if not os.path.exists(out):
                    open(out, "wb").write(z.read(n))
    dirs = [EXTRA, os.path.join(PI, "Datasheets"), os.path.join(PI, "Operating instructions", "EN")]
    if everything:
        dirs += [os.path.join(PI, "Operating instructions", "DE"), os.path.join(PI, "Operating instructions", "Setup Guides")]
    for d in dirs:
        for dp, _, fs in os.walk(d):
            for f in sorted(fs):
                if f.lower().endswith(".pdf"):
                    yield os.path.join(dp, f)


def extract(path):
    r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=300)
    pages = r.stdout.decode("utf-8", "replace").split("\f")
    return path, [p for p in pages]


def chunks(text, size=1800):
    text = re.sub(r"[ \t]+", " ", text).strip()
    while len(text) > size:
        cut = text.rfind("\n", size // 2, size)
        cut = cut if cut > 0 else size
        yield text[:cut].strip(); text = text[cut:].strip()
    if text:
        yield text


def main():
    everything = "--all" in sys.argv
    t0 = time.time()
    files = list(pdfs(everything))
    print(f"{len(files)} PDFs ({'all' if everything else 'EN + datasheets + MEDAQLib'})")
    if os.path.exists(DB):
        os.remove(DB)
    db = sqlite3.connect(DB)
    db.execute("""create virtual table docs using fts5(text, file unindexed, page unindexed, kind unindexed,
                  tokenize="unicode61 tokenchars '_#'")""")
    n_chunks, empty = 0, []
    with ThreadPoolExecutor(max_workers=os.cpu_count()) as ex:
        for i, (path, pages) in enumerate(ex.map(extract, files), 1):
            rel = os.path.relpath(path, ROOT) if path.startswith(ROOT) else os.path.basename(path)
            kind = "medaqlib" if "MEDAQLib_" in os.path.basename(path) else \
                   "datasheet" if "Datasheets" in path else "manual"
            got = 0
            for pno, ptxt in enumerate(pages, 1):
                for c in chunks(ptxt):
                    if len(c) > 40:
                        db.execute("insert into docs values (?,?,?,?)", (c, rel, pno, kind)); got += 1
            n_chunks += got
            if got < 3:
                empty.append(rel)
            if i % 25 == 0:
                print(f"  {i}/{len(files)}  chunks={n_chunks}  {time.time()-t0:.0f}s", flush=True)
    db.commit(); db.execute("insert into docs(docs) values('optimize')"); db.commit()
    print(f"done: {n_chunks} chunks in {time.time()-t0:.0f}s -> {DB}")
    if empty:
        print(f"WARNING {len(empty)} PDFs gave (almost) no text (scanned? need OCR):")
        for e in empty[:15]: print("  ", e)


main()
