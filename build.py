#!/usr/bin/env python3
"""Build HSK4_Exam_Practice.html — one self-contained offline file.

Content lives in data/ as plain text so it is easy to extend:
  words.json          1200 HSK 1-4 words
  sentences_*.txt     NO WORD|chunk/chunk/chunk。|English        (one example per line)
  passages.txt        @ passage / T true-statement / F false-statement / Q question|*right|wrong|wrong|wrong
  dialogues.txt       @ / 男：… / 女：… / Q question|*right|wrong|wrong|wrong
  orders.txt          first|second|third                         (correct order)
  pictures.txt        word|emoji|model sentence|model sentence
"""
import glob, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
D = lambda *p: os.path.join(ROOT, *p)
OUT = D('HSK4_Exam_Practice.html')
DESKTOP = os.path.expanduser('~/Desktop/HSK4_Exam_Practice.html')
SERVER_PUBLIC = D('server', 'public', 'index.html')

errs, warns = [], []
words = json.load(open(D('data', 'words.json'), encoding='utf-8'))
byno = {w['no']: w for w in words}
parts = lambda zh: [p for p in re.split(r'…+|\.{2,}', zh) if p]


def lines(path):
    for ln, line in enumerate(open(path, encoding='utf-8'), 1):
        line = line.strip()
        if line and not line.startswith('#'):
            yield ln, line


def parse_q(s, where):
    bits = [x.strip() for x in s.split('|')]
    q, opts = bits[0], bits[1:]
    star = [i for i, o in enumerate(opts) if o.startswith('*')]
    if len(opts) != 4 or len(star) != 1:
        errs.append(f'{where}: question needs 4 options with exactly one *: {s}')
        return None
    right = opts[star[0]][1:].strip()
    return [q, [right] + [o for i, o in enumerate(opts) if i != star[0]]]


# ---- sentences
sents = []
for f in sorted(glob.glob(D('data', 'sentences_*.txt'))):
    name = os.path.basename(f)
    for ln, line in lines(f):
        bits = [x.strip() for x in line.split('|')]
        if len(bits) != 2:
            errs.append(f'{name}:{ln} needs 2 fields: "<no> <chunks> | <English>"'); continue
        head, en = bits
        m = re.match(r'^(\d+)\s+(.+)$', head)
        if not m:
            errs.append(f'{name}:{ln} bad head {head}'); continue
        no, chunks = int(m.group(1)), m.group(2).strip()
        w = byno.get(no)
        if not w:
            errs.append(f'{name}:{ln} unknown word number {no}'); continue
        text = chunks.replace('/', '')
        for p in parts(w['zh']):
            c = text.count(p)
            if c == 0: errs.append(f'{name}:{ln} "{p}" not in sentence')
            elif c > 1: warns.append(f'{name}:{ln} "{p}" appears {c}x (first is blanked)')
        if '//' in chunks or chunks.startswith('/') or chunks.endswith('/'):
            errs.append(f'{name}:{ln} empty chunk')
        sents.append([no, chunks, en])

# ---- passages / dialogues
def blocks(path):
    out, cur = [], None
    for ln, line in lines(path):
        if line.startswith('@'):
            cur = {'ln': ln, 'head': line[1:].strip(), 'body': []}
            out.append(cur)
        elif cur is None:
            errs.append(f'{os.path.basename(path)}:{ln} text before first @')
        else:
            cur['body'].append((ln, line))
    return out

passages = []
if os.path.exists(D('data', 'passages.txt')):
    for b in blocks(D('data', 'passages.txt')):
        p = {'t': b['head'], 'tf': [], 'q': []}
        for ln, line in b['body']:
            tag, rest = line[:1], line[1:].strip()
            if tag in 'TF': p['tf'].append([rest, 1 if tag == 'T' else 0])
            elif tag == 'Q':
                q = parse_q(rest, f'passages.txt:{ln}')
                if q: p['q'].append(q)
            else: errs.append(f'passages.txt:{ln} unknown line')
        if not p['t']: errs.append(f'passages.txt:{b["ln"]} empty passage')
        passages.append(p)

dialogues = []
if os.path.exists(D('data', 'dialogues.txt')):
    for b in blocks(D('data', 'dialogues.txt')):
        d = {'l': [], 'q': None}
        for ln, line in b['body']:
            m = re.match(r'^(男|女)[：:](.+)$', line)
            if m: d['l'].append([m.group(1), m.group(2).strip()])
            elif line.startswith('Q'):
                d['q'] = parse_q(line[1:].strip(), f'dialogues.txt:{ln}')
            else: errs.append(f'dialogues.txt:{ln} unknown line')
        if len(d['l']) < 2 or not d['q']:
            errs.append(f'dialogues.txt:{b["ln"]} needs 2+ lines and a Q'); continue
        dialogues.append(d)

orders = []
if os.path.exists(D('data', 'orders.txt')):
    for ln, line in lines(D('data', 'orders.txt')):
        bits = [x.strip() for x in line.split('|')]
        if len(bits) != 3: errs.append(f'orders.txt:{ln} needs 3 sentences'); continue
        orders.append(bits)

pictures = []
if os.path.exists(D('data', 'pictures.txt')):
    for ln, line in lines(D('data', 'pictures.txt')):
        bits = [x.strip() for x in line.split('|')]
        if len(bits) < 3: errs.append(f'pictures.txt:{ln} needs word|emoji|model'); continue
        for m in bits[2:]:
            if bits[0] not in m: errs.append(f'pictures.txt:{ln} model misses word {bits[0]}')
        pictures.append(bits)

# ---- report
covered = {s[0] for s in sents}
print(f'words {len(words)} | sentences {len(sents)} (cover {len(covered)} words) | passages {len(passages)} '
      f'(2-question {sum(1 for p in passages if len(p["q"]) >= 2)}) | dialogues {len(dialogues)} '
      f'(short {sum(1 for d in dialogues if len(d["l"]) <= 2)}) | orders {len(orders)} | pictures {len(pictures)}')
for w in warns[:40]: print('warn', w)
if len(warns) > 40: print(f'... {len(warns) - 40} more warnings')
for e in errs: print('ERROR', e)
if errs: sys.exit(1)

data = {'words': [{k: w[k] for k in ('no', 'level', 'zh', 'py', 'en')} for w in words],
        'sentences': sents, 'passages': passages, 'dialogues': dialogues,
        'orders': orders, 'pictures': pictures}
tpl = open(D('src', 'index.html'), encoding='utf-8').read()
css = open(D('src', 'style.css'), encoding='utf-8').read()
js = open(D('src', 'app.js'), encoding='utf-8').read()
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = tpl.replace('/*CSS*/', css).replace('/*DATA*/null', blob).replace('/*JS*/', js)
open(OUT, 'w', encoding='utf-8').write(html)
shutil.copyfile(OUT, DESKTOP)
os.makedirs(os.path.dirname(SERVER_PUBLIC), exist_ok=True)
shutil.copyfile(OUT, SERVER_PUBLIC)
print(f'built {OUT} ({len(html) // 1024} KB) -> copied to {DESKTOP} and {SERVER_PUBLIC}')
