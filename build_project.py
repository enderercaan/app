#!/usr/bin/env python3
"""Tailmance Golden Master source packager.

Default mode is fail-closed production packaging. It refuses to call a source tree
production-ready when reproducible dependency resolution or local release gates are
missing. `--handoff` creates a verified source handoff archive while preserving an
explicit NOT_PRODUCTION_READY status when production-only gates remain open.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, stat, subprocess, sys, tempfile, zipfile
from pathlib import Path, PurePosixPath

APP='Tailmance'; OWNER='Yekta Özel'; SLOGAN='THE SOCIAL WORLD OF OUR FURRY FRIENDS'
ROOT_DEFAULT='.'
REQUIRED_BASE=[
 'package.json','app.config.ts','App.tsx','SOURCE_FILE_SHA256_MANIFEST.txt',
 'RELEASE_EVIDENCE.json','RELEASE_MANIFEST.json','assets','src','scripts','supabase','release','web',
 'web/delete-account.html','web/delete-account.js','web/config.js',
 'supabase/functions/delete-account/index.ts',
 'supabase/functions/process-account-deletion-request/index.ts',
 'release/release-blocker-inventory-v19.json',
]
PRODUCTION_ONLY=['package-lock.json']
EXCLUDED_DIRS={'.git','.hg','.svn','.idea','.vscode','.expo','.next','.turbo','.gradle','.claude','node_modules','Pods','DerivedData','coverage','dist','build','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache'}
EXCLUDED_FILES={'.claudeignore'}
SENSITIVE_EXACT={'.env','.npmrc','id_rsa','id_ed25519'}
SENSITIVE_SUFFIXES={'.p8','.p12','.pfx','.pem','.key','.keystore','.jks','.mobileprovision'}
SAFE_ENV={'.env.example','.env.sample','.env.template'}
SECRET_PATTERNS=[
 ('private_key',re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
 ('github_token',re.compile(rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b')),
 ('stripe_live',re.compile(rb'\bsk_live_[A-Za-z0-9]{20,}\b')),
 ('aws_access_key',re.compile(rb'\bAKIA[0-9A-Z]{16}\b')),
 ('sensitive_assignment',re.compile(rb'(?i)\b(?:SUPABASE_SERVICE_ROLE_KEY|SENTRY_AUTH_TOKEN|GOOGLE_OAUTH_SERVER_CLIENT_SECRET)\s*[:=]\s*[\"\']?(?!\$\{|<|REPLACE|CHANGE|YOUR_|PLACEHOLDER)[A-Za-z0-9._~+/=-]{16,}')),
]
TEXT_EXT={'.js','.jsx','.ts','.tsx','.json','.md','.txt','.html','.css','.yml','.yaml','.toml','.properties','.gradle','.kt','.java','.swift','.m','.mm','.xml','.sh','.py','.sql','.graphql','.gql'}

class Block(RuntimeError): pass

def sha(path:Path)->str:
 h=hashlib.sha256()
 with path.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
 return h.hexdigest()

def safe_name(s:str)->bool:
 p=PurePosixPath(s); return bool(s and not p.is_absolute() and '\\' not in s and all(x not in {'','.','..'} for x in p.parts))

def sensitive(p:Path)->bool:
 n=p.name.lower()
 if n in SAFE_ENV: return False
 if n=='.env' or n.startswith('.env.'): return True
 if n in SENSITIVE_EXACT: return True
 if any(n.endswith(x) for x in SENSITIVE_SUFFIXES): return True
 if (n.startswith('service-account') or n.startswith('service_account')) and n.endswith('.json'): return True
 return False

def run(cmd:list[str], cwd:Path)->None:
 cp=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True)
 if cp.returncode:
  tail=(cp.stdout+'\n'+cp.stderr)[-12000:]
  raise Block(f"Command failed ({' '.join(cmd)}):\n{tail}")

def validate(root:Path, production:bool)->dict:
 if not root.is_dir(): raise Block(f'Project root not found: {root}')
 missing=[p for p in REQUIRED_BASE if not (root/p).exists()]
 if production: missing += [p for p in PRODUCTION_ONLY if not (root/p).is_file()]
 if missing: raise Block('Missing required release paths:\n  - '+'\n  - '.join(missing))
 syms=[str(p.relative_to(root)) for p in root.rglob('*') if p.is_symlink()]
 if syms: raise Block('Symlinks are not allowed in release source: '+', '.join(syms[:20]))
 try: pkg=json.loads((root/'package.json').read_text('utf-8'))
 except Exception as e: raise Block(f'Invalid package.json: {e}')
 if pkg.get('name')!='tailmance': raise Block('package.json name must be tailmance')
 if production:
  try: lock=json.loads((root/'package-lock.json').read_text('utf-8'))
  except Exception as e: raise Block(f'Invalid package-lock.json: {e}')
  if not lock.get('lockfileVersion'): raise Block('package-lock.json missing lockfileVersion')
 html=(root/'web/delete-account.html').read_text('utf-8')
 js=(root/'web/delete-account.js').read_text('utf-8')
 for token in ['Tailmance','deleteForm','privacy.html','delete-account.js']:
  if token not in html: raise Block(f'Account-deletion page missing required token: {token}')
 for token in ['deletionRequestEndpoint','turnstileSiteKey','fetch(endpoint']:
  if token not in js: raise Block(f'Account-deletion client missing required token: {token}')
 return {'package_version':pkg.get('version'),'package_manager':pkg.get('packageManager')}

def scan(root:Path)->None:
 bad=[]; hits=[]
 for p in root.rglob('*'):
  if not p.is_file(): continue
  rel=p.relative_to(root)
  if any(x in EXCLUDED_DIRS for x in rel.parts[:-1]) or p.name in EXCLUDED_FILES: continue
  if sensitive(p): bad.append(rel.as_posix()); continue
  if p.suffix.lower() not in TEXT_EXT and p.name not in {'package.json','package-lock.json'}: continue
  try:
   if p.stat().st_size>5*1024*1024: continue
   data=p.read_bytes()
  except OSError as e: raise Block(f'Unreadable file {rel}: {e}')
  for label,rx in SECRET_PATTERNS:
   if rx.search(data): hits.append(f'{rel.as_posix()} [{label}]')
 if bad: raise Block('Sensitive files present:\n  - '+'\n  - '.join(bad[:40]))
 if hits: raise Block('High-confidence embedded secrets detected:\n  - '+'\n  - '.join(hits[:40]))

def snapshot(src:Path,dst:Path)->None:
 for p in sorted(src.rglob('*'), key=lambda x:x.as_posix()):
  rel=p.relative_to(src)
  if any(x in EXCLUDED_DIRS for x in rel.parts): continue
  if p.is_dir(): (dst/rel).mkdir(parents=True,exist_ok=True); continue
  if not p.is_file() or sensitive(p) or p.name in EXCLUDED_FILES: continue
  q=dst/rel; q.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(p,q)
  os.chmod(q,0o755 if p.stat().st_mode & stat.S_IXUSR else 0o644)

def manifest(dst:Path)->None:
 rows=[]
 for p in sorted((x for x in dst.rglob('*') if x.is_file()),key=lambda x:x.relative_to(dst).as_posix()):
  rel=p.relative_to(dst).as_posix()
  if rel=='release/GOLDEN_MASTER_PACKAGE.SHA256': continue
  rows.append(f'{sha(p)}  {rel}\n')
 q=dst/'release/GOLDEN_MASTER_PACKAGE.SHA256'; q.parent.mkdir(parents=True,exist_ok=True); q.write_text(''.join(rows),'utf-8')

def zipdet(src:Path,out:Path)->None:
 tmp=out.with_suffix(out.suffix+'.tmp'); tmp.parent.mkdir(parents=True,exist_ok=True)
 if tmp.exists(): tmp.unlink()
 with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED,compresslevel=9,allowZip64=True) as z:
  for p in sorted((x for x in src.rglob('*') if x.is_file()),key=lambda x:x.relative_to(src).as_posix()):
   rel=p.relative_to(src).as_posix()
   if not safe_name(rel): raise Block(f'Unsafe archive path: {rel}')
   info=zipfile.ZipInfo(rel,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.create_system=3
   info.external_attr=(stat.S_IFREG | (0o755 if p.stat().st_mode & stat.S_IXUSR else 0o644))<<16
   z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
 os.replace(tmp,out)

def verify(out:Path)->tuple[int,int]:
 with zipfile.ZipFile(out) as z:
  bad=z.testzip()
  if bad: raise Block(f'ZIP CRC failure: {bad}')
  names=z.namelist()
  if len(names)!=len(set(names)): raise Block('Duplicate ZIP entries')
  if any(not safe_name(n) for n in names): raise Block('Unsafe ZIP entry')
  mf='release/GOLDEN_MASTER_PACKAGE.SHA256'
  if mf not in names: raise Block('Golden Master manifest missing')
  rows={}
  for line in z.read(mf).decode().splitlines():
   d,n=line.split('  ',1); rows[n]=d
  payload={n for n in names if n!=mf}
  if set(rows)!=payload: raise Block('ZIP/Golden Master manifest mismatch')
  for n,d in rows.items():
   if hashlib.sha256(z.read(n)).hexdigest()!=d: raise Block(f'Hash mismatch: {n}')
  return len(names),len(rows)

def main()->int:
 ap=argparse.ArgumentParser(); ap.add_argument('--project-root',default=ROOT_DEFAULT); ap.add_argument('--output'); ap.add_argument('--handoff',action='store_true'); ap.add_argument('--skip-tests',action='store_true'); a=ap.parse_args()
 root=Path(a.project_root).resolve(); production=not a.handoff
 default='Tailmance_PRODUCTION_READY.zip' if production else 'Tailmance_FINAL_HANDOFF.zip'; out=Path(a.output or default).resolve()
 try:
  meta=validate(root,production); scan(root)
  if not a.skip_tests:
   run(['npm','run','verify:offline'],root)
   if production: run(['npm','run','release:structure'],root)
  with tempfile.TemporaryDirectory(prefix='tailmance-gm-') as td:
   st=Path(td)/'source'; st.mkdir(); snapshot(root,st)
   status='PRODUCTION_SOURCE_PACKAGE' if production else 'HANDOFF_ONLY_NOT_PRODUCTION_READY'
   sf=st/'release/GOLDEN_MASTER_STATUS.json'; keep=False
   if sf.is_file():
    try: keep=json.loads(sf.read_text('utf-8')).get('status')==status
    except (OSError,ValueError): keep=False
   # A committed status record that already states this package status stays byte-identical, so the extracted archive still matches SOURCE_FILE_SHA256_MANIFEST.txt.
   if not keep: sf.write_text(json.dumps({'schema_version':1,'app':APP,'owner_publisher':OWNER,'slogan':SLOGAN,'status':status,'package_version':meta.get('package_version'),'package_manager':meta.get('package_manager'),'external_live_release_gates_separate':True},ensure_ascii=False,indent=2,sort_keys=True)+'\n','utf-8')
   manifest(st); zipdet(st,out)
  entries,hashed=verify(out); digest=sha(out); side=Path(str(out)+'.sha256'); side.write_text(f'{digest}  {out.name}\n','utf-8')
  print('='*78); print('TAILMANCE GOLDEN MASTER:', 'PASS' if production else 'HANDOFF PASS'); print('Output:',out); print('SHA-256:',digest); print('Entries:',entries,'Hashed:',hashed); print('Owner & Publisher:',OWNER); print('='*78)
  if not production: print('WARNING: Handoff mode does not claim production readiness.')
  return 0
 except Block as e:
  for p in [out,Path(str(out)+'.sha256')]:
   try:
    if p.exists(): p.unlink()
   except OSError: pass
  print('='*78,file=sys.stderr); print('TAILMANCE GOLDEN MASTER: BLOCKED',file=sys.stderr); print(e,file=sys.stderr); print('='*78,file=sys.stderr); return 2
 except Exception as e:
  for p in [out,Path(str(out)+'.sha256')]:
   try:
    if p.exists(): p.unlink()
   except OSError: pass
  print('='*78,file=sys.stderr); print('TAILMANCE GOLDEN MASTER: BLOCKED BY UNEXPECTED ERROR',file=sys.stderr); print(f'{type(e).__name__}: {e}',file=sys.stderr); print('='*78,file=sys.stderr); return 3

if __name__=='__main__': raise SystemExit(main())
