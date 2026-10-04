const readList=(name)=>(process.env[name]??'').split(',').map(x=>x.trim()).filter(Boolean);
const boost=readList('EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS');
const superLikes=readList('EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS');
const raw=(process.env.REVENUECAT_CONSUMABLE_PRODUCTS_JSON??'').trim();
const failures=[];
if(!boost.length)failures.push('EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS missing');
if(!superLikes.length)failures.push('EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS missing');
const overlap=boost.filter(id=>superLikes.includes(id));
if(overlap.length)failures.push('client consumable product IDs overlap across kinds');
let products={};
try{
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('shape');
  products=parsed;
}catch{failures.push('REVENUECAT_CONSUMABLE_PRODUCTS_JSON missing or invalid')}
for(const id of boost){if(products[id]?.kind!=='boost'||!Number.isInteger(products[id]?.quantity)||products[id].quantity<1)failures.push(`${id}: server consumable map must define boost with positive integer quantity`)}
for(const id of superLikes){if(products[id]?.kind!=='super_like'||!Number.isInteger(products[id]?.quantity)||products[id].quantity<1)failures.push(`${id}: server consumable map must define super_like with positive integer quantity`)}
if(failures.length)throw new Error(`Consumable client/server config consistency failed (${failures.length} issues):\n- ${failures.join('\n- ')}`);
console.log(`consumable-config-consistency-check: ${boost.length} boost + ${superLikes.length} super-like client products exactly mapped by server credit authority`);
