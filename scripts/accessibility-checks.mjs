import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files=[];
const walk=(dir)=>{for(const name of readdirSync(dir)){const path=join(dir,name);if(statSync(path).isDirectory())walk(path);else if(path.endsWith('.tsx'))files.push(path)}};
walk('src');
let pressables=0; let textInputs=0; let switches=0;
for(const file of files){
  const source=readFileSync(file,'utf8');
  const tags=source.match(/<Pressable\b[^>]*>/gs)??[];
  for(const tag of tags){
    pressables++;
    assert.match(tag,/accessibilityRole=["'](?:button|checkbox|radio|switch|link|tab)["']/,`${file}: Pressable missing an actionable accessibilityRole`);
    if(/\bdisabled=/.test(tag))assert.match(tag,/accessibilityState=/,`${file}: disabled Pressable must expose accessibilityState`);
  }
}

for(const file of files){
  const source=readFileSync(file,'utf8');
  const inputs=source.match(/<TextInput\b[^>]*>/gs)??[];
  for(const tag of inputs){
    textInputs++;
    assert.match(tag,/accessibilityLabel=/,`${file}: TextInput missing accessibilityLabel`);
  }
}

for(const file of files){
  const source=readFileSync(file,'utf8');
  const controls=source.match(/<Switch\b[^>]*>/gs)??[];
  for(const tag of controls){
    switches++;
    assert.match(tag,/accessibilityLabel=/,`${file}: Switch missing accessibilityLabel`);
  }
}

const primary=readFileSync('src/components/PrimaryButton.tsx','utf8');
assert.match(primary,/accessibilityLabel=\{label\}/,'PrimaryButton must expose its label');
const icon=readFileSync('src/components/IconButton.tsx','utf8');
assert.match(icon,/accessibilityLabel=\{label\}/,'IconButton must expose an accessibility label');
const petCard=readFileSync('src/components/PetCard.tsx','utf8');
assert.match(petCard,/accessibilityLabel=\{t\('petCard\.photoA11y',\{name:pet\.name\}\)\}/,'Pet card image should expose the localized photo accessibility label');

const health=readFileSync('src/screens/HealthScreen.tsx','utf8');
assert.match(health,/accessibilityState=\{\{selected:h\.neutered===x\.v,disabled:Boolean\(actionBusy\)\}\}/,'Health tri-state choice must announce selected and disabled state');
const discover=readFileSync('src/screens/DiscoverScreen.tsx','utf8');
assert.match(discover,/accessibilityState=\{\{selected:selected\.includes\(x\)\}\}/,'Discovery suggestions must announce selected state');
const meetups=readFileSync('src/screens/MeetupsScreen.tsx','utf8');
assert.match(meetups,/accessibilityState=\{\{selected:value===true\}\}/,'Meetup nullable yes/no controls must announce selected state');
const primaryButton=readFileSync('src/components/PrimaryButton.tsx','utf8');
assert.match(primaryButton,/busy:Boolean\(loading\)/,'PrimaryButton loading state must be exposed to accessibility services');

const profile=readFileSync('src/screens/ProfileScreen.tsx','utf8');
assert.match(profile,/accessibilityLabel=\{t\('profile\.edit'\)\}[\s\S]*styles\.editCircle/,'Icon-only profile edit control must have a localized accessibility label');
assert.match(profile,/accessibilityState=\{\{selected:activePet\.id===p\.id\}\}/,'Active pet switcher must announce selected state');
assert.match(profile,/petChip:\{minHeight:44/,'Pet switcher touch targets must be at least 44px tall');
const settingsA11y=readFileSync('src/screens/SettingsScreen.tsx','utf8');
assert.match(settingsA11y,/planAction:\{minHeight:44/,'Settings plan action touch target must be at least 44px tall');
const feedA11y=readFileSync('src/screens/FeedScreen.tsx','utf8');
assert.match(feedA11y,/previewRemove:\{position:'absolute',end:5,top:5,width:44,height:44/,'Feed remove-photo control must expose a 44x44 touch target');
const retryNotice=readFileSync('src/components/RetryNotice.tsx','utf8');
assert.match(retryNotice,/t\('common\.retry'\)/,'RetryNotice copy must be localized');


const reduceMotionHook=readFileSync('src/hooks/useReduceMotion.ts','utf8');
assert.match(reduceMotionHook,/AccessibilityInfo\.isReduceMotionEnabled\(\)/,'Reduce Motion preference must be read from the OS');
assert.match(reduceMotionHook,/reduceMotionChanged/,'Reduce Motion changes must be observed at runtime');
const swipeable=readFileSync('src/components/SwipeableCard.tsx','utf8');
assert.match(swipeable,/const reduceMotion=useReduceMotion\(\)/,'Swipe interactions must read Reduce Motion');
assert.match(swipeable,/if\(reduceMotion\)\{position\.setValue/,'Swipe completion animation must be bypassed when Reduce Motion is enabled');
for(const imageFile of files){
  const imageSource=readFileSync(imageFile,'utf8');
  if(/transition=\{/.test(imageSource)){
    assert.doesNotMatch(imageSource,/transition=\{\d+\}/,`${imageFile}: image transitions must respect Reduce Motion instead of using a fixed duration`);
    assert.match(imageSource,/useReduceMotion\(\)/,`${imageFile}: image transitions require the shared Reduce Motion preference`);
  }
}

for(const modalFile of ['src/screens/DiscoverScreen.tsx','src/screens/EventsScreen.tsx','src/screens/FeedScreen.tsx','src/screens/HealthScreen.tsx','src/screens/MeetupsScreen.tsx']){
  const modalSource=readFileSync(modalFile,'utf8');
  assert.match(modalSource,/useReduceMotion\(\)/,`${modalFile}: modal surfaces must read Reduce Motion`);
  assert.match(modalSource,/animationType=\{reduceMotion\?'none':/,`${modalFile}: modal animations must be disabled when Reduce Motion is enabled`);
}

const modalSources=files.map(file=>readFileSync(file,'utf8')).join('\n');
const modalCount=(modalSources.match(/<Modal\b/g)??[]).length;
const modalA11yCount=(modalSources.match(/accessibilityViewIsModal/g)??[]).length;
assert.equal(modalA11yCount,modalCount,`All ${modalCount} Modal surfaces must expose accessibilityViewIsModal`);

const authDynamicType=readFileSync('src/screens/AuthScreen.tsx','utf8');
const resetDynamicType=readFileSync('src/screens/ResetPasswordScreen.tsx','utf8');
assert.doesNotMatch(authDynamicType,/input:\{height:|passwordWrap:\{height:|passwordInput:\{[^}]*height:/,'Auth inputs must grow for Dynamic Type');
assert.doesNotMatch(resetDynamicType,/inputWrap:\{height:|input:\{[^}]*height:/,'Reset-password inputs must grow for Dynamic Type');

assert.doesNotMatch(readFileSync('src/navigation/AppNavigator.tsx','utf8'),/tabBarStyle:\{height:76/,'Bottom tab bar must not use a fixed height that can clip Dynamic Type labels');
console.log(`accessibility-checks: ${pressables} Pressables + ${textInputs} TextInputs + ${switches} Switches + ${modalCount} Modals checked; passed`);
