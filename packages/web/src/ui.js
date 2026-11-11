// The studio shell: project tabs on the left, output tabs on the right, theme, version.
// It only shows and hides things; the form, the prompt and the generations work the same in any layout.
/* global __APP_VERSION__ */
const store={
  get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
};

export function initUi(){
  const $$=s=>[...document.querySelectorAll(s)];

  function tabs(btnAttr,paneAttr,key,fallback){
    const show=id=>{
      const btn=$$("["+btnAttr+"]").find(b=>b.getAttribute(btnAttr)===id&&!b.hidden);
      if(!btn)id=fallback;
      $$("["+btnAttr+"]").forEach(b=>{const on=b.getAttribute(btnAttr)===id;b.classList.toggle("on",on);b.setAttribute("aria-pressed",on)});
      $$("["+paneAttr+"]").forEach(p=>p.classList.toggle("on",p.getAttribute(paneAttr)===id));
      store.set(key,id);
    };
    document.addEventListener("click",e=>{const b=e.target.closest("["+btnAttr+"]");if(b)show(b.getAttribute(btnAttr))});
    show(store.get(key,fallback));
    return show;
  }
  const showPanel=tabs("data-panel","data-panel-id","trsr-panel","story");
  const showOut=tabs("data-rtab","data-rtab-id","trsr-out","prompt");

  // Bring whatever holds this element into view: used by the checklist, the timeline and "generate".
  window.trsrShow=el=>{
    if(!el)return;
    const p=el.closest("[data-panel-id]");if(p)showPanel(p.getAttribute("data-panel-id"));
    const r=el.closest("[data-rtab-id]");if(r)showOut(r.getAttribute("data-rtab-id"));
  };

  // Without the local server there is nothing to generate: the Generate buttons and the Generations tab follow #gen and #lib.
  const gen=document.querySelector("#gen"),lib=document.querySelector("#lib"),libTab=document.querySelector('[data-rtab="library"]');
  const mirror=()=>{
    $$("[data-gen]").forEach(b=>{b.hidden=gen.hidden});
    const was=libTab.hidden;libTab.hidden=lib.hidden;
    if(lib.hidden&&libTab.classList.contains("on"))showOut("prompt");
    if(was&&!lib.hidden&&!store.get("trsr-out-chosen",""))showOut("library");
  };
  new MutationObserver(mirror).observe(gen,{attributes:true,attributeFilter:["hidden"]});
  new MutationObserver(mirror).observe(lib,{attributes:true,attributeFilter:["hidden"]});
  mirror();
  document.addEventListener("click",e=>{
    if(e.target.closest("[data-gen]"))gen.click();
    if(e.target.closest("[data-rtab]"))store.set("trsr-out-chosen","1");
  });

  // Theme: dark unless the person chose light.
  const themeBtn=document.querySelector("#theme"),root=document.documentElement;
  const paint=()=>{const dark=root.dataset.theme!=="light";themeBtn.textContent=dark?"☀":"☾";themeBtn.setAttribute("aria-label",dark?"Tema claro / Light theme":"Tema escuro / Dark theme");themeBtn.title=themeBtn.getAttribute("aria-label")};
  themeBtn.addEventListener("click",()=>{root.dataset.theme=root.dataset.theme==="light"?"dark":"light";store.set("trsr-theme",root.dataset.theme);paint()});
  paint();

  const ver=document.querySelector("#ver");
  if(ver)ver.textContent="v"+(typeof __APP_VERSION__==="string"?__APP_VERSION__:"");
}
