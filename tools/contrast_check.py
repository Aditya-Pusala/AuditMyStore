import re, json, os

def extract_root_vars(text):
    m = re.search(r":root\s*\{([\s\S]*?)\}", text)
    vars = {}
    if not m:
        return vars
    body = m.group(1)
    # find all --var: value; pairs even if compacted on one line
    for mm in re.finditer(r"(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);?", body):
        k = mm.group(1).strip()
        v = mm.group(2).strip()
        vars[k] = v
    return vars


def parse_color(s):
    if s is None:
        return None
    s=s.strip()
    if s.startswith('var('):
        return ('var', s)
    if s.startswith('#'):
        h=s[1:]
        if len(h)==3:
            r=int(h[0]*2,16); g=int(h[1]*2,16); b=int(h[2]*2,16)
        elif len(h)==6:
            r=int(h[0:2],16); g=int(h[2:4],16); b=int(h[4:6],16)
        else:
            return None
        return ( (r,g,b), 1.0 )
    m = re.match(r'rgba?\(([^)]+)\)', s)
    if m:
        parts=[p.strip() for p in m.group(1).split(',')]
        if len(parts)>=3:
            try:
                r=int(float(parts[0])); g=int(float(parts[1])); b=int(float(parts[2])); a=1.0
            except:
                return None
            if len(parts)==4:
                try: a=float(parts[3])
                except: a=1.0
            return ((r,g,b), a)
    return None


def resolve(val, vars):
    if not val: return None
    val=val.strip()
    if val.startswith('var('):
        inner=re.match(r'var\((--[^),]+)', val)
        if inner:
            name=inner.group(1)
            return resolve(vars.get(name, ''), vars)
        return None
    return parse_color(val)


def composite(fg, bg):
    (fr,fgc,fb), fa = fg
    (br,bg2,bb), ba = bg
    a_out = fa + ba*(1-fa)
    if a_out == 0: return ((0,0,0),0)
    r = int(round((fa*fr + (1-fa)*br)))
    g = int(round((fa*fgc + (1-fa)*bg2)))
    b = int(round((fa*fb + (1-fa)*bb)))
    return ((r,g,b), 1.0)


def srgb_to_lin(c):
    c = c/255.0
    if c <= 0.03928:
        return c/12.92
    return ((c+0.055)/1.055)**2.4


def luminance(rgb):
    r,g,b = rgb
    R = srgb_to_lin(r)
    G = srgb_to_lin(g)
    B = srgb_to_lin(b)
    return 0.2126*R + 0.7152*G + 0.0722*B


def contrast_ratio(c1, c2):
    L1 = luminance(c1)
    L2 = luminance(c2)
    L_high = max(L1,L2)
    L_low = min(L1,L2)
    return (L_high+0.05)/(L_low+0.05)

# Load files
root_vars = {}
shared_path = os.path.join('shared.css')
if os.path.exists(shared_path):
    with open(shared_path,'r',encoding='utf-8') as f:
        shared = f.read()
    root_vars.update(extract_root_vars(shared))
# index override
index_path = os.path.join('index.html')
if os.path.exists(index_path):
    with open(index_path,'r',encoding='utf-8') as f:
        idx = f.read()
    root_vars.update(extract_root_vars(idx))
# login override
login_path = os.path.join('login.html')
if os.path.exists(login_path):
    with open(login_path,'r',encoding='utf-8') as f:
        login = f.read()
    root_vars.update(extract_root_vars(login))
# account override
acct_path = os.path.join('account.html')
if os.path.exists(acct_path):
    with open(acct_path,'r',encoding='utf-8') as f:
        acct = f.read()
    root_vars.update(extract_root_vars(acct))

# normalize values
for k in list(root_vars.keys()):
    root_vars[k] = root_vars[k].strip()

pairs = [
    ('--ink','--paper2','Body text on page background'),
    ('--ink2','--paper','Secondary text on paper'),
    ('--paper','--teal','White on teal (CTA)'),
    ('--paper','--teal-dark','White on dark teal'),
    ('--teal','--paper','Teal text on paper'),
    ('--teal-dark','--paper','Dark teal text on paper'),
]

results = []
for fg_k, bg_k, label in pairs:
    fg_val = root_vars.get(fg_k)
    bg_val = root_vars.get(bg_k)
    fg = resolve(fg_val, root_vars)
    bg = resolve(bg_val, root_vars)
    note = ''
    if fg is None:
        note = f'Foreground {fg_k} not found or unsupported ({fg_val})'
        results.append({'label':label,'fg':fg_k,'bg':bg_k,'ok':False,'ratio':None,'note':note})
        continue
    if bg is None:
        note = f'Background {bg_k} not found or unsupported ({bg_val})'
        results.append({'label':label,'fg':fg_k,'bg':bg_k,'ok':False,'ratio':None,'note':note})
        continue
    if bg[1] < 1:
        bg = composite(bg, ((255,255,255),1.0))
    if fg[1] < 1:
        fg = composite(fg, bg)
    ratio = contrast_ratio(fg[0], bg[0])
    ok_AA = ratio >= 4.5
    ok_AALarge = ratio >= 3.0
    ok_AAA = ratio >= 7.0
    results.append({'label':label,'fg':fg_k,'bg':bg_k,'ratio':round(ratio,2),'AA':ok_AA,'AALarge':ok_AALarge,'AAA':ok_AAA})

print(json.dumps({'vars':root_vars,'checks':results}, indent=2))

def parse_css_rules(text):
    rules = {}
    for m in re.finditer(r'([^{}]+)\{([^}]+)\}', text):
        selector = m.group(1).strip()
        body = m.group(2)
        color = None
        bg = None
        for mm in re.finditer(r'(?:color|background(?:-color)?)\s*:\s*([^;]+);?', body):
            prop = mm.group(0)
            name = mm.group(0)
        # better scan properties explicitly
        for line in body.split(';'):
            if ':' not in line:
                continue
            k,v = line.split(':',1)
            k=k.strip(); v=v.strip()
            if k in ('color',):
                color = v
            if k in ('background','background-color'):
                bg = v
        # handle multiple comma selectors
        for sel in selector.split(','):
            s = sel.strip()
            if s:
                rules[s] = {'color':color,'background':bg}
    return rules


def scan_html_for_checks(css_rules, vars, filenames):
    page_checks = {}
    for fname in filenames:
        if not os.path.exists(fname):
            continue
        with open(fname,'r',encoding='utf-8') as f:
            html = f.read()
        checks_local = []
        # inline styles
        for m in re.finditer(r'<([a-zA-Z0-9]+)([^>]*)style="([^"]+)"([^>]*)>', html):
            tag = m.group(1)
            attrs = m.group(2)+m.group(4)
            style = m.group(3)
            col=None; bg=None
            for part in style.split(';'):
                if ':' not in part: continue
                k,v = part.split(':',1)
                k=k.strip(); v=v.strip()
                if k=='color': col=v
                if k in ('background','background-color'): bg=v
            if col and bg:
                fg = resolve(col, vars)
                bgc = resolve(bg, vars)
                if fg and bgc:
                    if bgc[1]<1: bgc = composite(bgc, ((255,255,255),1.0))
                    if fg[1]<1: fg = composite(fg, bgc)
                    ratio = contrast_ratio(fg[0], bgc[0])
                    checks_local.append({'file':fname,'type':'inline','tag':tag,'ratio':round(ratio,2),'pass_AA': ratio>=4.5})
        # selector-based: support simple selectors .class, #id, tag
        for sel, props in css_rules.items():
            simple = None
            if sel.startswith('.') or sel.startswith('#') or re.match(r'^[a-zA-Z]+$', sel):
                simple = sel
            if not simple:
                continue
            col = props.get('color')
            bg = props.get('background')
            if not col or not bg:
                continue
            # find elements matching selector
            if simple.startswith('.'):
                cname = simple[1:]
                pattern = r'class\s*=\s*"[^"]*\b' + re.escape(cname) + r'\b[^"]*"'
            elif simple.startswith('#'):
                iname = simple[1:]
                pattern = r'id\s*=\s*"' + re.escape(iname) + r'"'
            else:
                pattern = r'<'+re.escape(simple)+r'[^>]*>'
            hits = re.findall(pattern, html)
            if not hits:
                continue
            fg = resolve(col, vars)
            bgc = resolve(bg, vars)
            if not fg or not bgc:
                continue
            if bgc[1]<1: bgc = composite(bgc, ((255,255,255),1.0))
            if fg[1]<1: fg = composite(fg, bgc)
            ratio = contrast_ratio(fg[0], bgc[0])
            checks_local.append({'file':fname,'type':'selector','selector':simple,'ratio':round(ratio,2),'pass_AA': ratio>=4.5,'matches':len(hits)})
        page_checks[fname]=checks_local
    return page_checks


css_text = ''
if os.path.exists(shared_path):
    with open(shared_path,'r',encoding='utf-8') as f:
        css_text += f.read()
for extra in ('index.html','login.html','account.html'):
    if os.path.exists(extra):
        with open(extra,'r',encoding='utf-8') as f:
            css_text += '\n' + f.read()

css_rules = parse_css_rules(css_text)

files = ['index.html','login.html','account.html']
page_checks = scan_html_for_checks(css_rules, root_vars, files)

print('\nSCANNED ELEMENT CHECKS:')
print(json.dumps(page_checks, indent=2))
