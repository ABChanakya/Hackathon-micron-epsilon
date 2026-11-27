"""Search the docs.  python3 -I query.py "SP_Measrate Set_Samplerate" [-n 5] [-k medaqlib|manual|datasheet] [-f substring] [-w 700]"""
import argparse, os, re, sqlite3

p = argparse.ArgumentParser()
p.add_argument("q"); p.add_argument("-n", type=int, default=5)
p.add_argument("-k", help="kind: medaqlib | manual | datasheet"); p.add_argument("-f", help="file path substring")
p.add_argument("-w", type=int, default=700, help="chars of context per hit")
a = p.parse_args()
db = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.db"))
terms = re.findall(r"[\w#]+", a.q)
where, args = "", []
if a.k: where += " and kind=?"; args.append(a.k)
if a.f: where += " and file like ?"; args.append(f"%{a.f}%")
for op in (" AND ", " OR "):   # exact-all first, then fall back to any-term
    m = op.join(f'"{t}"' for t in terms)
    rows = db.execute(f"""select file,page,kind,snippet(docs,0,'>>','<<',' … ',64),text from docs
        where docs match ? {where} order by bm25(docs) limit ?""", [m, *args, a.n]).fetchall()
    if rows: break
for i, (f, pg, k, snip, text) in enumerate(rows, 1):
    print(f"[{i}] {f}  p.{pg}  ({k})")
    j = max(text.find(">>"), 0) if ">>" in text else 0
    print("    " + re.sub(r"\s+", " ", text[max(0, text.lower().find(terms[0].lower()) - 150):][:a.w]).strip() + "\n")
if not rows: print("no hits")
