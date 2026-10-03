import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots=['store/screenshots/ios','store/screenshots/android'];
const issues=[];
for(const root of roots){
  if(!existsSync(root)){issues.push(`${root} is missing`);continue;}
  const files=readdirSync(root).filter(name=>/\.(png|jpe?g)$/i.test(name)&&statSync(join(root,name)).size>0);
  if(files.length===0)issues.push(`${root} has no production screenshots`);
}
if(issues.length){
  console.error(`store-assets-release-check: BLOCKED (${issues.length} issues)`);
  for(const issue of issues)console.error(`- ${issue}`);
  process.exitCode=1;
}else console.log('store-assets-release-check: iOS + Android production screenshot sets present');
