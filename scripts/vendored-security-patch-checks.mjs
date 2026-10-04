import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Tailmance-maintained security patches for dependencies that have no upstream fixed release.
// Remove an entry (and its vendor tarball) as soon as upstream publishes a patched version.
const require=createRequire(import.meta.url);
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));

const patches=[
  {name:'node-forge',version:'1.4.1-tailmance.1',tarball:'vendor/node-forge-1.4.1-tailmance.1.tgz',advisory:'GHSA-86w9-cpqp-85rv'},
  {name:'braces',version:'3.0.4-tailmance.1',tarball:'vendor/braces-3.0.4-tailmance.1.tgz',advisory:'GHSA-vfj7-8cjw-p6xm'},
];
for(const patch of patches){
  assert.equal(pkg.optionalDependencies?.[patch.name],`file:${patch.tarball}`,`${patch.name}: root spec must point to the vendored tarball`);
  assert.equal(pkg.overrides?.[patch.name],`$${patch.name}`,`${patch.name}: override must force every dependent to the vendored copy`);
  const entry=lock.packages?.[`node_modules/${patch.name}`];
  assert.equal(entry?.version,patch.version,`${patch.name}: lockfile version`);
  assert.equal(entry?.resolved,`file:${patch.tarball}`,`${patch.name}: lockfile must resolve to the vendored tarball`);
  const integrity=`sha512-${createHash('sha512').update(readFileSync(patch.tarball)).digest('base64')}`;
  assert.equal(entry.integrity,integrity,`${patch.name}: lockfile integrity must match the tarball`);
  assert.equal(JSON.parse(readFileSync(require.resolve(`${patch.name}/package.json`),'utf8')).version,patch.version,`${patch.name}: installed copy must be the patched version (run npm ci)`);
}

// node-forge: DigestInfo with extra nested DigestAlgorithm members must be rejected.
const forge=require('node-forge');
const {pki,asn1,md}=forge;
const keys=pki.rsa.generateKeyPair({bits:1024,e:0x10001});
const digest=md.sha256.create().update('tailmance').digest().getBytes();
const universal=(type,constructed,value)=>asn1.create(asn1.Class.UNIVERSAL,type,constructed,value);
function forgedSignature(algorithmExtras){
  const algorithm=[universal(asn1.Type.OID,false,asn1.oidToDer(pki.oids.sha256).getBytes()),universal(asn1.Type.NULL,false,''),...algorithmExtras];
  const info=universal(asn1.Type.SEQUENCE,true,[universal(asn1.Type.SEQUENCE,true,algorithm),universal(asn1.Type.OCTETSTRING,false,digest)]);
  const der=asn1.toDer(info).getBytes();
  const block=`\x00\x01${'\xff'.repeat(128-3-der.length)}\x00${der}`;
  return pki.rsa.encrypt(block,keys.privateKey,false);
}
assert.equal(keys.publicKey.verify(digest,keys.privateKey.sign(md.sha256.create().update('tailmance'))),true,'node-forge: genuine signature must verify');
assert.equal(keys.publicKey.verify(digest,forgedSignature([])),true,'node-forge: canonical hand-built DigestInfo must verify');
assert.throws(()=>keys.publicKey.verify(digest,forgedSignature([universal(asn1.Type.OCTETSTRING,false,'EXTRA')])),/DigestInfo/,'node-forge: extra nested DigestAlgorithm element must be rejected');
assert.throws(()=>keys.publicKey.verify(digest,forgedSignature([universal(asn1.Type.NULL,false,'')])),/DigestInfo/,'node-forge: second NULL in DigestAlgorithm must be rejected');

// braces: deep nesting must fail fast with SyntaxError instead of exhausting the stack.
const braces=require('braces');
assert.deepEqual(braces.expand('a{b,c{d,e}}f'),['abf','acdf','acef'],'braces: ordinary nesting unchanged');
assert.deepEqual(braces.expand('{a,b}{1..2}'),['a1','a2','b1','b2'],'braces: sequences unchanged');
assert.equal(braces.expand(`${'{'.repeat(128)}a,b${'}'.repeat(128)}`).length,2,'braces: depth at the limit still expands');
for(const fn of ['expand','compile','parse','create']){
  assert.throws(()=>braces[fn](`${'{'.repeat(4000)}a,b${'}'.repeat(4000)}`),SyntaxError,`braces.${fn}: excessive nesting must raise SyntaxError`);
}
console.log(`vendored-security-patch-checks: ${patches.length} patched dependencies (${patches.map(p=>p.advisory).join(', ')}) pinned, integrity-bound and behaviour-tested; PASS`);
