import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Test-only in-memory compilation of the repository's own pure fare modules.
// Reusing the engine avoids hard-coded quote amounts in hosted fixtures.
export function fixtureFare({phase5Active,uplift,surgeMode='normal',surgeMultiplier=1}) {
 const root=process.cwd(),cache=new Map(),native=createRequire(path.join(root,'package.json'));
 function load(filename){
  filename=path.resolve(filename);
  assertPure(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const record={exports:{}};cache.set(filename,record);
  const output=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const require=specifier=>{
   if(!specifier.startsWith('.')&&!specifier.startsWith('@/'))return native(specifier);
   const base=specifier.startsWith('@/')?path.join(root,'src',specifier.slice(2)):path.resolve(path.dirname(filename),specifier);
   const target=[base,base+'.ts',path.join(base,'index.ts')].find(existsSync);if(!target)throw Error('Missing pure fare dependency');
   return load(target);
  };
  new Function('require','module','exports',output)(require,record,record.exports);
  return record.exports;
 }
 function assertPure(filename){
  const relative=path.relative(root,filename).replaceAll('\\','/');
  if(!/^src\/lib\/(domain\/|fare\/|pricing\/universalFare\.ts$)/.test(relative))throw Error('Non-pure fixture import denied');
 }
 const {calculateFare}=load(path.join(root,'src/lib/fare/calculateFare.ts'));
 const {calculateFinalJourneyFare}=load(path.join(root,'src/lib/domain/fare.ts'));
 const {priceStandardFare}=load(path.join(root,'src/lib/pricing/universalFare.ts'));
 const base=calculateFare({distanceKm:2,distanceDiscountKm:0,durationMin:5,rideOptionId:'go',surgeLabel:surgeMode,surgeMultiplier,includeEmbeddedBookingFee:!phase5Active});
 const fare=calculateFinalJourneyFare({baseFare:base,routeDistanceKm:2,addStopIncrease:0,stopWaitingFee:0});
 return priceStandardFare(fare.totalFare,uplift);
}
