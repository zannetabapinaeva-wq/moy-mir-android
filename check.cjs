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
   if(t.type==='puzzle'){
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
 // First-entry field stays empty even if an unfinished old welcome had the example name.
 const callbacks=[];
 const fresh={...sandbox,window:{addEventListener(){},scrollTo(){}},localStorage:{getItem:()=>JSON.stringify({onboarded:false,name:'Абубакар'}),setItem(){}},setTimeout:(cb,ms)=>{if(ms===400)callbacks.push(cb);return 0}};
 vm.createContext(fresh);vm.runInContext(fs.readFileSync('app/src/main/assets/www/app.js','utf8'),fresh);callbacks[0]();
 assert.equal(fresh.window.MoyMir.state.name,'');
 assert.ok(elements.get('#modal').innerHTML.includes('Напишите имя<input name="name" value=""'));
 console.log(JSON.stringify({activitiesCompleted:total,uniqueDays:days.size,uniqueActivities:ids.size,retryAndHelp:'passed',parentGate:'passed',schedule:'passed',localProgress:'passed',resetConfirmationAndCancellation:'passed',resetPreservesSettings:'passed',emptyWelcomeName:'passed',browserQA:'unavailable: preview daemon missing'}));
})().catch(e=>{console.error(e);process.exit(1)});
