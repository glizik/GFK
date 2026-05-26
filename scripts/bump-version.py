#!/usr/bin/env python3
"""Update the version badge in index.html and dashboard.html with current git info."""
import re, subprocess, sys

cwd = '/Users/lizik.gabor/DEV/GFK'
version = subprocess.check_output(['git', 'rev-list', '--count', 'HEAD'], cwd=cwd).decode().strip()
sha     = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'],  cwd=cwd).decode().strip()

PATTERN = (
    r'(<span style="font-weight:600">)v\d+'
    r'(</span><span style="opacity:0\.45;font-size:10px;font-family:monospace;margin-left:6px">)'
    r'v[a-f0-9]+'
    r'(</span>)'
)
REPLACEMENT = rf'\g<1>v{version}\g<2>v{sha}\g<3>'

changed = False
for path in [f'{cwd}/index.html', f'{cwd}/data/dashboard.html']:
    with open(path) as f:
        content = f.read()
    new = re.sub(PATTERN, REPLACEMENT, content)
    if new != content:
        with open(path, 'w') as f:
            f.write(new)
        print(f'bumped {path.split("/")[-1]} → v{version} ({sha})')
        changed = True
    else:
        print(f'no change: {path.split("/")[-1]} already at v{version} ({sha})')

sys.exit(0 if changed else 2)
