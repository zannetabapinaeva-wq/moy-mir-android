const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map(),listeners={},stored=new Map([['moy-mir-v1',JSON.stringify({onboarded:true})]]);
const element=()=>({innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},querySelectorAll(){return[]},focus(){}});
const sandbox={console,URL,Blob,Intl,Date,Math,JSON,Number,String,Array,Set,Promise,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},document:{querySelector:s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s)},documentElement:element(),body:element(),addEventListener:(t,cb)=>listeners[t]=cb},navigator:{},window:{addEventListener(){},scrollTo(){}}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('app/src/main/assets/www/app.js','utf8'),sandbox);
const evaluate=code=>vm.runInContext(code,sandbox);
const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
(async()=>{
 let total=0;const ids=new Set(),days=new Set();
 for(let day=1;day<=60;day++){
  const tasks=sandbox.window.MoyMir.dayTasks(day);assert.equal(tasks.length,8);days.add(tasks.map(t=>t.type+':'+t.seed).join('|'));
  for(const t of tasks){
   ids.add(t.id);sandbox.testTask=t;evaluate('startTask(testTask)');let d=evaluate('gameData');
   if(t.type==='memory')await click({action:'memory-hide'});
   if(['sorter','pyramid','tower','beads'].includes(t.type)){
    const count=evaluate('toyState.count');for(let j=0;j<count;j++){const id=t.type==='beads'?evaluate('toyState.pattern['+j+']'):j;await click({action:'toy-piece',value:String(id)});await click({action:'toy-place',value:String(t.type==='sorter'?id:t.type==='beads'?j:0)})}
   }else if(t.type==='puzzle'){
    let p=evaluate('puzzle');for(let i=0;i<p.length;i++){if(p[i]!==i){await click({action:'puzzle-piece',index:String(i)});await click({action:'puzzle-piece',index:String(p.indexOf(i))});p=evaluate('puzzle')}}
   }else if(t.type==='life'){for(let v=0;v<3;v++)await click({action:'order',value:String(v)})}
   else if(t.type==='sort'){for(let i=0;i<d.items.length;i++){await click({action:'sort-pick',index:String(i)});await click({action:'sort-drop',value:String(d.items[i])})}}
   else{d=evaluate('gameData');assert.ok(t.type==='choice'||d.options.includes(d.target),`missing target ${t.id}`);await click({action:'answer',value:String(d.target),index:String(t.type==='odd'?d.oddPos:d.options.indexOf(d.target))})}
   assert.ok(evaluate('success'),`not completed ${t.id} (${t.type})`);assert.ok(sandbox.window.MoyMir.state.completed[t.id],`not persisted ${t.id}`);total++;
  }
 }
 assert.equal(total,480);assert.equal(ids.size,480);assert.equal(days.size,60);
 // Wrong answers stay playable, help is non-punitive, and a retry can succeed.
 evaluate("state.level='3'; startTask({type:'find',day:1,index:0,seed:7,id:'retry-check'})");
 let d=evaluate('gameData'),wrong=d.options.find(v=>v!==d.target);
 await click({action:'answer',value:String(wrong),index:'0'});assert.equal(evaluate('success'),false);
 await click({action:'answer',value:String(wrong),index:'0'});assert.equal(evaluate('hinted'),true);
 await click({action:'answer',value:String(d.target),index:String(d.options.indexOf(d.target))});assert.equal(evaluate('success'),true);
 // Reload reconstructs progress; schedule toggling and parent gate do not erase it.
 const before=Object.keys(sandbox.window.MoyMir.state.completed).length;
 evaluate('navigate("schedule")');await click({action:'schedule-check',index:'0'});assert.ok(evaluate('state.checked[today()].includes(0)'));
 await click({action:'schedule-check',index:'0'});assert.equal(evaluate('state.checked[today()].includes(0)'),false);
 evaluate('showGate()');const answer=sandbox.window.gateAnswer;
 await click({action:'gate-answer',value:String(answer+99)});assert.ok(elements.get('#modal').innerHTML.includes('Вход для родителей'));
 await click({action:'gate-answer',value:String(answer)});assert.ok(elements.get('#modal').innerHTML.includes('Настройки для родителей'));
 assert.equal(Object.keys(JSON.parse(stored.get('moy-mir-v1')).completed).length,before);
 const source=fs.readFileSync('app/src/main/assets/www/sw.js','utf8');assert.ok(source.includes('assets/objects.webp'));assert.ok(source.includes('app.js'));
 // Reset requires the parent's gate and a separate confirmation; cancellation preserves progress.
 evaluate("state.name='Тестовое имя';state.day=61;state.skills=[1];state.checked={test:[0]};state.custom=[{label:'Моя карточка',image:'data:image/png;base64,AA=='}]");
 await click({action:'reset-confirm'});assert.equal(sandbox.window.MoyMir.state.day,61);
 await click({action:'reset-program'});assert.ok(elements.get('#modal').innerHTML.includes('Вход для родителей'));
 await click({action:'gate-answer',value:String(sandbox.window.gateAnswer)});assert.ok(elements.get('#modal').innerHTML.includes('Сбросить и начать с дня 1'));
 await click({action:'close'});assert.equal(Object.keys(sandbox.window.MoyMir.state.completed).length,before);
 await click({action:'reset-confirm'});assert.equal(sandbox.window.MoyMir.state.day,61);
 const retained=JSON.stringify({name:sandbox.window.MoyMir.state.name,schedule:sandbox.window.MoyMir.state.schedule,custom:sandbox.window.MoyMir.state.custom,level:sandbox.window.MoyMir.state.level});
 await click({action:'reset-program'});await click({action:'gate-answer',value:String(sandbox.window.gateAnswer)});await click({action:'reset-confirm'});
 assert.equal(sandbox.window.MoyMir.state.day,1);
 for(const key of ['completed','skills','history','checked'])assert.equal(Object.keys(sandbox.window.MoyMir.state[key]).length,0);
 assert.equal(JSON.stringify({name:sandbox.window.MoyMir.state.name,schedule:sandbox.window.MoyMir.state.schedule,custom:sandbox.window.MoyMir.state.custom,level:sandbox.window.MoyMir.state.level}),retained);
 assert.equal(JSON.parse(stored.get('moy-mir-v1')).day,1);
 assert.ok(elements.get('#app').innerHTML.includes('День 1'));
 sandbox.testTask=sandbox.window.MoyMir.dayTasks(1)[0];evaluate('startTask(testTask)');assert.ok(evaluate('gameData.id').startsWith('d1-'));
 // Every selected answer and result reaches the Android speech bridge.
 const speech=[];const bridge={speak:text=>speech.push(text),stop(){},getVoices:()=>"[]"};sandbox.MoyMirNative=bridge;sandbox.window.MoyMirNative=bridge;sandbox.window.speechSynthesis=sandbox.speechSynthesis={cancel(){},speak:u=>speech.push(u.text),getVoices:()=>[]};sandbox.SpeechSynthesisUtterance=function(text){this.text=text};
 evaluate("state.speech=true;state.feedback='direct';startTask({type:'find',day:1,index:0,seed:1,id:'speech-apple'})");
 let apple=evaluate('gameData');let other=apple.options.find(v=>v!==1);
 await click({action:'answer',value:String(other),index:String(apple.options.indexOf(other))});assert.ok(speech.at(-1).includes('Это не яблоко.'));
 await click({action:'answer',value:'1',index:String(apple.options.indexOf(1))});assert.ok(speech.at(-1).includes('Правильно, это яблоко.'));
 assert.ok(elements.get('#app').innerHTML.includes('primary next-big'));assert.ok(elements.get('#app').innerHTML.includes('answer-success'));
 evaluate('navigate("home")');assert.ok(elements.get('#app').innerHTML.includes('quick-answer yes'));assert.ok(elements.get('#app').innerHTML.includes('quick-answer no'));
 await click({action:'quick-answer',answer:'Да'});assert.equal(speech.at(-1),'Да');await click({action:'quick-answer',answer:'Нет'});assert.equal(speech.at(-1),'Нет');
 await click({action:'nav',route:'wants'});assert.equal(speech.at(-1),'Я хочу');
 for(const type of ['sorter','pyramid','tower','beads']){
  sandbox.toyType=type;evaluate("state.level='3';startTask({type:toyType,day:22,index:0,seed:7,id:'toy-'+toyType})");
  await click({action:'toy-piece',value:'0'});await click({action:'toy-place',value:type==='sorter'?'1':type==='beads'?'5':'0'});
  if(type==='sorter'||type==='beads')assert.equal(evaluate('toyState.placed.length'),0);
  await click({action:'hint'});assert.equal(evaluate('hinted'),true);
  while(!evaluate('success')){let id=evaluate('toyExpected()'),target=type==='sorter'?id:type==='beads'?evaluate('toyState.placed.length'):0;await click({action:'toy-piece',value:String(id)});assert.ok(speech.at(-1).length>0);await click({action:'toy-place',value:String(target)})}
  assert.ok(speech.at(-1).includes('Правильно!'));
 }
 evaluate("state.speech=false");const silence=speech.length;await click({action:'quick-answer',answer:'Да'});assert.equal(speech.length,silence);evaluate("state.speech=true");
 // The real pointer handlers place a dragged shape in its matching opening.
 evaluate("startTask({type:'sorter',day:22,index:0,seed:7,id:'pointer-sorter'})");
 let ghostRemoved=false;const ghost={classList:{add(){}},style:{},remove(){ghostRemoved=true}};
 const piece={dataset:{toyPiece:'0'},setPointerCapture(){},releasePointerCapture(){},cloneNode:()=>ghost,getBoundingClientRect:()=>({width:100,height:100})};
 sandbox.document.body.appendChild=()=>{};sandbox.document.elementFromPoint=()=>({closest:()=>({dataset:{toyTarget:'0'}})});
 listeners.pointerdown({target:{closest:()=>piece},pointerId:1,clientX:10,clientY:10});listeners.pointermove({pointerId:1,clientX:60,clientY:60,preventDefault(){}});listeners.pointerup({pointerId:1,clientX:100,clientY:100});
 assert.ok(ghostRemoved);assert.equal(evaluate('toyState.placed[0]'),0);evaluate('lastToyDrag=0');
 // Previously completed daily games retain their original activity type after adding toys.
 evaluate("state.completed['d40-t0']={day:40,type:'find'}");assert.equal(sandbox.window.MoyMir.dayTasks(40)[0].type,'find');
 // First-entry field stays empty even if an unfinished old welcome had the example name.
 const callbacks=[];
 const fresh={...sandbox,window:{addEventListener(){},scrollTo(){}},localStorage:{getItem:()=>JSON.stringify({onboarded:false,name:'Абубакар'}),setItem(){}},setTimeout:(cb,ms)=>{if(ms===400)callbacks.push(cb);return 0}};
 vm.createContext(fresh);vm.runInContext(fs.readFileSync('app/src/main/assets/www/app.js','utf8'),fresh);callbacks[0]();
 assert.equal(fresh.window.MoyMir.state.name,'');
 assert.ok(elements.get('#modal').innerHTML.includes('Напишите имя<input name="name" value=""'));
 console.log(JSON.stringify({activitiesCompleted:total,uniqueDays:days.size,uniqueActivities:ids.size,retryAndHelp:'passed',parentGate:'passed',schedule:'passed',localProgress:'passed',resetConfirmationAndCancellation:'passed',resetPreservesSettings:'passed',emptyWelcomeName:'passed',spokenChoicesAndAnswers:'passed',fourToyGames:'passed',dragAndTap:'passed',largeNextButton:'passed',browserQA:'unavailable: preview daemon missing'}));
})().catch(e=>{console.error(e);process.exit(1)});
