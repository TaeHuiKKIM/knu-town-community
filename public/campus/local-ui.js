import {summary,parseBackup,MAX_BACKUP_BYTES,CATALOG,BOX_THEMES,BOX_PRICE,OUTFIT_BOX_PRICE,remainingOutfitSets} from './local-data.js';
import {OUTFIT_BOX_SETS} from './wardrobe.js';
import {ArchiveSync} from './local-sync.js';
import {CopyCheckpoint} from './local-checkpoint.js';
import {clock} from './study-time.js';
import {saved} from './network.js';

const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const THEMES=[{id:'plain',item:null,name:'기본',cost:0,image:'/campus/assets/icons/navigation-frame-3.png'},{id:'ginkgo',item:'focus-ginkgo',name:'은행나무길',cost:24,image:'/campus/assets/previews/ginkgo.png'},{id:'lounge',item:'focus-lounge',name:'도서관 라운지',cost:36,image:'/campus/assets/previews/lounge.png'},{id:'sunset',item:'focus-sunset',name:'노을 광장',image:'/campus/assets/previews/plaza.png'},{id:'moonlight',item:'focus-moonlight',name:'달빛 산책',image:'/campus/assets/previews/ginkgo.png'}].map(theme=>({...theme,cost:CATALOG.find(item=>item.id===(theme.item||'plain')).cost}));
const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');

export class LocalUI {
  constructor({vault,room,study,toast,openError,onTotals}){
    Object.assign(this,{vault,room,study,toast,onTotals});this.busy=false;this.tab='records';this.file=null;this.problem=openError||'';
    this.syncer=new ArchiveSync({vault,room,onError:()=>{this.problem='최근 기록을 아직 이 브라우저에 저장하지 못했어요';this.render();}});
    this.checkpoint=new CopyCheckpoint({vault,room,study,syncer:this.syncer,hasPending:()=>!!saved.get('localStorage','knu-study-stop'),onOffline:()=>{$('backup-local-option').hidden=false;}});
    this.sessionGeneration=vault?.generation;this.generation=vault?.generation;this.owner=vault?.state.profile.key;
    vault?.addEventListener('change',()=>{
      if(this.owner!==vault.state.profile.key||this.generation!==vault.generation){this.owner=vault.state.profile.key;this.generation=vault.generation;this.syncer.clear();}
      this.problem='';this.render();this.onTotals();
    });
    const tabs=[...document.querySelectorAll('[data-local-tab]')];
    tabs.forEach((button,index)=>{
      button.addEventListener('click',()=>this.setTab(button.dataset.localTab));
      button.addEventListener('keydown',event=>{
        const destination={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
        if(destination===undefined)return;
        event.preventDefault();
        const target=tabs[destination];
        this.setTab(target.dataset.localTab);
        target.focus();
      });
    });
    $('backup-export').addEventListener('click',()=>void this.backup());
    $('backup-file').addEventListener('change',e=>void this.inspect(e.target.files?.[0]));
    $('backup-merge').addEventListener('click',()=>void this.apply('merge'));
    $('backup-replace').addEventListener('click',()=>void this.apply('replace'));
    $('backup-restore').addEventListener('click',()=>void this.restore());
    $('backup-check').addEventListener('click',()=>void this.checkCopy());
    $('local-retry').addEventListener('click',()=>{void this.study.refresh();this.render();});
    $('local-reload').addEventListener('click',()=>location.reload());
    this.boxButton=node('button','menu-action full');
    this.boxButton.type='button';
    const chest=node('img','seed-chest');chest.src='/campus/assets/icons/seed-chest.png';chest.alt='';
    this.boxLabel=node('span');this.boxButton.append(chest,this.boxLabel);
    this.boxButton.addEventListener('click',()=>void this.openBox());
    this.outfitBox=this.boxButton.cloneNode(true);
    this.outfitBox.addEventListener('click',()=>void this.openBox('outfit'));
    this.bumpTool=node('button','menu-action full');
    this.bumpTool.type='button';
    const glove=node('img','ui-icon');glove.src='/campus/assets/play/bump.png';glove.alt='';
    this.bumpPrice=node('span');this.bumpTool.append(glove,this.bumpPrice);
    this.bumpTool.addEventListener('click',()=>void this.buyBump());
    const offers=node('div','shop-offers');
    offers.append(this.bumpTool,this.boxButton,this.outfitBox);
    $('focus-shop').before(offers);
    this.cards=new Map();
    for(const theme of THEMES){
      const card=node('article','focus-card'),img=node('img');card.dataset.theme=theme.id;img.src=theme.image;img.alt='';img.classList.toggle('plain-preview',!theme.item);
      const label=node('strong','',theme.name),price=node('span','focus-price'),button=node('button','menu-action');button.type='button';button.addEventListener('click',()=>void this.useTheme(theme));card.append(img,label,price,button);$('focus-shop').append(card);this.cards.set(theme.id,{button,price});
    }
    this.render();
  }
  get stale(){return !!this.vault&&(this.vault.state.profile.key!==this.room.profileKey||this.vault.generation!==this.sessionGeneration);}
  get totals(){return this.vault&&!this.stale?summary(this.vault.state,Date.now()):null;}
  observe(data){if(!this.stale&&data?.archive)void this.syncer.observe(data.archive).then(()=>this.render());this.render();}
  async saveAppearance(patch){if(!this.vault||this.stale)return;try{await this.vault.updateProfile(patch);}catch{this.problem='외형을 아직 이 브라우저에 저장하지 못했어요';this.toast(this.problem);this.render();}}
  setTab(id){this.tab=id;
    const title={records:'내 기록',themes:'씨앗 상점',backup:'기록 백업'}[id];
    $('local-title').textContent=title;
    $('local-dialog').querySelector('.close').setAttribute('aria-label',title+' 닫기');
    for(const name of ['records','themes','backup'])$('local-'+name).hidden=name!==id;document.querySelectorAll('[data-local-tab]').forEach(button=>{
    const selected=button.dataset.localTab===id;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
  });this.render();}
  render(){
    const total=this.totals,state=this.stale?null:this.vault?.state;
    $('local-error').textContent=this.problem;
    $('local-reload').hidden=!this.stale&&!!this.vault;$('local-reload').textContent=this.stale?'변경된 자료로 새로고침':'브라우저 저장 다시 열기';
    $('local-status').textContent=this.stale?'다른 탭에서 자료가 바뀌었어요. 새로고침해주세요':!state?'브라우저 저장을 사용할 수 없어요':this.syncer.running?'최근 기록을 저장하는 중':this.problem?'저장 상태를 확인해주세요':'이 브라우저에 저장됨';
    $('local-retry').hidden=!this.vault||!this.problem||!this.room.online;
    for(const [id,value]of [['local-total',total?.totalMs],['local-today',total?.todayMs],['local-week',total?.weekMs]])$(id).textContent=clock(value||0);
    $('local-seeds').textContent=String(total?.balance||0);$('theme-seeds').textContent=String(total?.balance||0);$('local-saved-at').textContent=state?new Date(state.updatedAt).toLocaleString('ko-KR'):'저장된 자료 없음';
    const list=$('local-history');list.replaceChildren();
    for(const row of (total?.recent||[]).slice(0,20)){
      const item=node('li','local-record'),head=node('div',''),subject=node('strong','',row.subject);head.append(subject,node('time','',new Date(row.fromAt).toLocaleDateString('ko-KR')));
      const detail=node('details');detail.append(node('summary','','공부 내용'),node('p','',row.note));item.append(head,node('span','subtle',clock(row.toAt-row.fromAt)),detail);list.append(item);
    }
    if(!list.childElementCount)list.append(node('li','empty','공부 내용을 확인하면 여기에 남아요'));
    for(const theme of THEMES){const card=this.cards?.get(theme.id);if(!card)continue;const owned=!theme.item||total?.ownedItemIds.includes(theme.item),selected=total?.theme===theme.id;card.price.textContent=owned?'보유':`${theme.cost} 씨앗`;card.button.textContent=selected?'사용 중':owned?'사용':'구매';card.button.disabled=!state||this.busy||selected||!owned&&total.balance<theme.cost;card.button.setAttribute('aria-label',`${theme.name} ${card.button.textContent}`);}
    this.hasBump=!!total?.ownedItemIds.includes('play-bump');
    const price=CATALOG.find(item=>item.id==='play-bump').cost;
    this.bumpPrice.textContent=this.hasBump?'장난 장갑 · 보유':`툭 치기 장갑 · ${price} 씨앗`;
    this.bumpTool.disabled=!state||this.busy||this.hasBump||total.balance<price;
    const outfits=total ? remainingOutfitSets(total.rewardMs,total.ownedItemIds) : [];
    this.outfitBox.lastElementChild.textContent=outfits.length ? '코디 상자 열기 · '+OUTFIT_BOX_PRICE+' 씨앗' : '상자 코디를 모두 열었어요';
    this.outfitBox.disabled=!state||this.busy||!outfits.length||total.balance<OUTFIT_BOX_PRICE;
    const missing=BOX_THEMES.filter(id=>!total?.ownedItemIds.includes(id)).length;
    this.boxLabel.textContent=missing ? `배경 상자 열기 · ${BOX_PRICE} 씨앗` : '상자 배경을 모두 모았어요';
    this.boxButton.disabled=!state||this.busy||!missing||total.balance<BOX_PRICE;
    for(const theme of THEMES.filter(t=>BOX_THEMES.includes(t.item))){
      const card=this.cards.get(theme.id);
      if(!total?.ownedItemIds.includes(theme.item)){
        card.price.textContent='배경 상자에서 획득';card.button.textContent='미보유';card.button.disabled=true;
        card.button.setAttribute('aria-label',theme.name+' 미보유');
      }
    }
    $('study-focus').dataset.theme=total?.theme||'plain';
    const active=!!this.study.active||!!saved.get('localStorage','knu-study-stop');
    $('backup-export').disabled=!state||this.busy||active;$('backup-file').disabled=!state||this.busy||active;
    $('backup-merge').disabled=!state||this.busy||!this.file||active||this.file.profile.key!==state.profile.key;
    $('backup-replace').disabled=!state||this.busy||!this.file||active;
    $('backup-restore').disabled=!state||this.busy||active||!$('backup-snapshots').value;
    $('backup-active').hidden=!active;
    $('backup-check').disabled=!state||this.busy;
    $('backup-local-only').disabled=!state||this.busy||active;
    if(this.tab==='backup'&&!this.busy&&!this.stale)void this.snapshots();
  }
  async snapshots(){
    if(!this.vault)return;const select=$('backup-snapshots'),prior=select.value;
    try{const owner=this.vault.state.profile.key,generation=this.vault.generation,copies=await this.vault.getSnapshots();if(this.stale||owner!==this.vault.state.profile.key||generation!==this.vault.generation)return;select.replaceChildren();for(const copy of copies){const option=node('option','',`${copy.state.profile.name||'이름 없음'} · ${new Date(copy.createdAt).toLocaleString('ko-KR')} · ${copy.state.records.length}건`);option.value=copy.id;select.append(option);}if([...select.options].some(o=>o.value===prior))select.value=prior;$('backup-restore').disabled=this.busy||!!this.study.active||!!saved.get('localStorage','knu-study-stop')||!select.value;}
    catch{$('backup-error').textContent='복구 자료를 읽지 못했어요';}
  }
  async buyBump(){
    if(!this.vault||this.busy||this.stale||this.hasBump)return;
    this.busy=true;this.render();
    try{await this.vault.buy('play-bump',requestId());this.toast('광장에서 툭 치기를 사용할 수 있어요');}
    catch(error){this.toast(error.message);}
    finally{this.busy=false;this.render();}
  }
  async openBox(kind='theme'){
    if(this.busy||!this.vault||this.stale)return;
    this.busy=true;this.render();
    try{
      const id=requestId(),state=await this.vault.openBox(id,kind);
      const item=state.purchases.find(entry=>entry.id===id);
      const theme=THEMES.find(entry=>entry.item===item?.itemId);
      if(!this.stale&&kind==='outfit'&&item)this.toast(OUTFIT_BOX_SETS[item.itemId].name+' 획득 · 옷장에서 입어보세요');
      if(!this.stale&&theme)this.toast(theme.name+' 배경을 얻었어요');
    }catch(error){this.toast(error.message);}
    finally{this.busy=false;this.render();}
  }
  async useTheme(theme){
    if(!this.vault||this.busy||this.stale)return;this.busy=true;this.render();
    try{const generation=this.vault.generation;if(theme.item&&!this.totals.ownedItemIds.includes(theme.item))await this.vault.buy(theme.item,requestId());if(this.stale||generation!==this.vault.generation)throw Error('자료가 바뀌었어요. 새로고침해주세요');await this.vault.setTheme(theme.id);this.toast('집중 배경을 바꿨어요');}
    catch(error){this.problem=error.message;this.toast(error.message);}
    finally{this.busy=false;this.render();}
  }
  async backup(){
    if(!this.vault||this.busy||this.study.active||this.stale)return;this.busy=true;$('backup-error').textContent='';this.render();
    try{
      const expectedKey=this.vault.state.profile.key,expectedGeneration=this.vault.generation;
      await this.checkpoint.check({expectedKey,expectedGeneration,localOnly:$('backup-local-only').checked});
      const text=await this.vault.exportText({expectedKey,expectedGeneration}),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=`knu-town-${new Date().toISOString().slice(0,10)}.knutown.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      this.toast('백업 파일 저장을 요청했어요');
    }catch(error){$('backup-error').textContent=error.message;}finally{this.busy=false;this.render();}
  }
  async checkCopy(){
    if(!this.vault||this.busy||this.stale)return;this.busy=true;$('backup-error').textContent='';this.render();
    try{await this.checkpoint.check();$('backup-local-only').checked=false;$('backup-local-option').hidden=true;this.toast('최근 공부 상태를 확인했어요');}
    catch(error){$('backup-error').textContent=error.message;}finally{this.busy=false;this.render();}
  }
  async inspect(file){
    const version=this.fileVersion=(this.fileVersion||0)+1;
    this.file=null;this.fileText=null;$('backup-error').textContent='';$('backup-preview').hidden=true;
    if(!file){this.render();return;}
    try{if(file.size>MAX_BACKUP_BYTES)throw Error('백업 파일이 너무 커요');const text=await file.text();if(version!==this.fileVersion)return;const data=parseBackup(text),total=summary(data);this.file=data;this.fileText=text;$('backup-preview-text').textContent=`${data.profile.name||'이름 없음'} · 공부 ${clock(total.totalMs)} · ${total.balance} 씨앗 · ${data.records.length}건`;$('backup-preview').hidden=false;}
    catch(error){if(version===this.fileVersion)$('backup-error').textContent=error.message;}
    this.render();
  }
  async beforeTransfer(options){
    if(this.stale)throw Error('다른 탭에서 자료가 바뀌었어요. 새로고침해주세요');
    await this.checkpoint.check({...options,localOnly:$('backup-local-only').checked});
    this.syncer.clear();if(this.room.me){try{await this.room.leave();}catch(error){if(this.room.me)throw error;}}
  }
  async apply(mode){
    if(!this.vault||this.busy||!this.fileText)return;this.busy=true;$('backup-error').textContent='';this.render();
    try{const expectedKey=this.vault.state.profile.key,expectedGeneration=this.vault.generation;await this.beforeTransfer({expectedKey,expectedGeneration});await this.vault.importText(this.fileText,{mode,expectedKey,expectedGeneration});this.restoreLegacy();location.reload();}
    catch(error){$('backup-error').textContent=error.message;this.toast(error.message);}finally{this.busy=false;this.render();}
  }
  async restore(){
    const id=$('backup-snapshots').value;if(!this.vault||this.busy||!id)return;this.busy=true;this.render();
    try{const expectedKey=this.vault.state.profile.key,expectedGeneration=this.vault.generation;await this.beforeTransfer({expectedKey,expectedGeneration});await this.vault.restoreSnapshot(id,{expectedKey,expectedGeneration});this.restoreLegacy();location.reload();}
    catch(error){$('backup-error').textContent=error.message;this.toast(error.message);}finally{this.busy=false;this.render();}
  }
  restoreLegacy(){
    const p=this.vault.state.profile;for(const [key,value]of Object.entries({'knu-profile-key':p.key,'knu-name':p.name,'knu-avatar':p.avatar,'knu-coat':p.coat}))saved.set('localStorage',key,value);
    try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('knu-session:'))saved.remove('sessionStorage',key);}}catch{}
  }
}
