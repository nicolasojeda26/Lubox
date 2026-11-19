(() => {
  const STORAGE_KEY = 'lubox-cross-v1';
  const DB_NAME = 'lubox-cross-files';
  let remoteAuthenticated = false;
  let remoteLoading = false;
  let cloudSaveTimer = null;
  let state = loadState();
  let selectedFile = null;
  let selectedPreviewUrl = null;
  let deferredInstallPrompt = null;
  let toastTimer;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function localISO(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  function shiftDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return localISO(d); }
  function dateOffset(days) { const d = new Date(); d.setDate(d.getDate() - days); return localISO(d); }
  function seedState() {
    const students = [
      {id:'s1',name:'Sofía Martínez',phone:'11 4582 9031',plan:'Libre · mensual',fee:35000,lastPayment:dateOffset(12)},
      {id:'s2',name:'Tomás Fernández',phone:'11 6091 7430',plan:'3 veces por semana',fee:32000,lastPayment:dateOffset(45)},
      {id:'s3',name:'Camila Rodríguez',phone:'11 3177 2608',plan:'Libre · mensual',fee:35000,lastPayment:dateOffset(30)},
      {id:'s4',name:'Mateo González',phone:'11 5530 8142',plan:'2 veces por semana',fee:28000,lastPayment:dateOffset(38)},
      {id:'s5',name:'Valentina López',phone:'11 3884 1095',plan:'Libre · mensual',fee:35000,lastPayment:dateOffset(4)},
      {id:'s6',name:'Joaquín Díaz',phone:'11 2675 8890',plan:'3 veces por semana',fee:32000,lastPayment:dateOffset(55)},
      {id:'s7',name:'Lucía Benítez',phone:'11 4460 5127',plan:'2 veces por semana',fee:28000,lastPayment:dateOffset(22)}
    ];
    const payments = [
      {id:'p1',studentId:'s5',date:dateOffset(4),amount:35000,note:'Transferencia',receiptId:null},
      {id:'p2',studentId:'s1',date:dateOffset(12),amount:35000,note:'Cuota mensual',receiptId:null},
      {id:'p3',studentId:'s4',date:dateOffset(38),amount:28000,note:'',receiptId:null},
      {id:'p4',studentId:'s3',date:dateOffset(30),amount:35000,note:'',receiptId:null}
    ];
    return {students,payments,settings:defaultSettings(),demo:true};
  }
  function defaultSettings() { return {whatsappRemindersEnabled:false,reminderDays:14}; }
  function normalizeState(value) {
    value.settings={...defaultSettings(),...(value.settings||{})};
    value.students.forEach(s=>{s.whatsappOptIn=Boolean(s.whatsappOptIn);s.lastReminderForDueDate=s.lastReminderForDueDate||'';});
    if(typeof value.demo!=='boolean')value.demo=!(value.students.some(s=>!/^s[1-7]$/.test(s.id))||value.payments.some(p=>!/^p[1-4]$/.test(p.id)));
    return value;
  }
  function loadState() {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { const parsed = JSON.parse(saved); if (parsed.students && parsed.payments) return normalizeState(parsed); } } catch {}
    const fresh = seedState(); localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); return fresh;
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if(remoteAuthenticated&&!remoteLoading&&!state.demo){
      clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(saveRemoteState,650);
    }
  }
  function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function formatDate(iso) {
    if (!iso) return '—';
    const [y,m,d] = iso.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}).replace('.', '');
  }
  function money(value) { return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value)||0); }
  function dayDiff(fromISO, toISO = localISO()) {
    if (!fromISO) return 9999;
    const [fy,fm,fd] = fromISO.split('-').map(Number), [ty,tm,td] = toISO.split('-').map(Number);
    return Math.round((Date.UTC(ty,tm-1,td)-Date.UTC(fy,fm-1,fd))/86400000);
  }
  function dueISO(student) {
    if (!student.lastPayment) return '';
    const [y,m,d] = student.lastPayment.split('-').map(Number);
    const date = new Date(y,m-1,d); date.setDate(date.getDate()+30); return localISO(date);
  }
  function studentStatus(student) {
    if (!student.lastPayment) return {key:'unpaid',label:'Sin pagos',detail:'Sin pagos registrados'};
    const overdue = dayDiff(dueISO(student));
    const threshold=Math.max(1,Number(state.settings?.reminderDays)||14);
    if (overdue > threshold) return {key:'late',label:'Atrasada',detail:`${overdue} días de atraso`};
    if (overdue > 0) return {key:'grace',label:'Vencida',detail:`${overdue} ${overdue === 1 ? 'día' : 'días'} de atraso`};
    if (overdue >= -7) return {key:'soon',label:overdue === 0 ? 'Vence hoy' : 'Vence pronto',detail:overdue === 0 ? 'Vence hoy' : `Vence en ${Math.abs(overdue)} días`};
    return {key:'current',label:'Al día',detail:'Cuota vigente'};
  }
  function statusPill(student) {
    const s=studentStatus(student); const cls=s.key==='late'?'status-late':s.key==='current'?'status-current':s.key==='grace'?'status-grace':s.key==='unpaid'?'status-neutral':'status-soon';
    return `<span class="status ${cls}"><i></i>${escapeHTML(s.label.toUpperCase())}</span>`;
  }
  function initials(name='?') { return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase(); }
  function person(student, index=0) {
    const avatarClass=['','pinkish','yellowish'][index%3];
    return `<div class="person"><span class="person-avatar ${avatarClass}">${escapeHTML(initials(student.name))}</span><span class="person-info"><b>${escapeHTML(student.name)}</b><small>${escapeHTML(student.phone||'Sin teléfono')}</small></span></div>`;
  }
  function whatsappNumber(raw='') {
    const source=String(raw).trim();
    let digits=String(raw).replace(/\D/g,'');
    if(source.startsWith('+'))return digits;
    if(digits.startsWith('00'))return digits.slice(2);
    if(digits.startsWith('54'))return digits;
    digits=digits.replace(/^0+/, '').replace(/^15/, '');
    return digits?`549${digits}`:'';
  }
  function whatsappLink(student) {
    const number=whatsappNumber(student.phone);if(!number)return '';
    const overdue=Math.max(0,dayDiff(dueISO(student)));
    const message=`Hola ${student.name}, te escribimos de Lubox Cross: tu cuota figura vencida hace ${overdue} días. Cuando puedas, envianos el comprobante o escribinos si ya abonaste. ¡Gracias!`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }
  function whatsappAction(student) {
    if(!student.whatsappOptIn||!student.phone||studentStatus(student).key!=='late')return '';
    return `<a class="row-action" title="Abrir WhatsApp con un aviso" href="${escapeHTML(whatsappLink(student))}" target="_blank" rel="noopener">☏</a>`;
  }
  function paymentStudent(payment) { return state.students.find(s=>s.id===payment.studentId); }
  function sortedPayments() { return [...state.payments].sort((a,b)=>b.date.localeCompare(a.date)); }

  function render() {
    const counts={current:0,soon:0,grace:0,late:0,unpaid:0};
    state.students.forEach(s=>counts[studentStatus(s).key]++);
    $('#stat-total').textContent=state.students.length; $('#stat-current').textContent=counts.current;
    $('#stat-soon').textContent=counts.soon; $('#stat-late').textContent=counts.late;
    $('#late-count').textContent=counts.late; $('#nav-students').textContent=state.students.length;
    const whatsappReady=state.students.filter(s=>studentStatus(s).key==='late'&&s.phone&&s.whatsappOptIn).length;
    $('#whatsapp-count').textContent=whatsappReady;$('#whatsapp-count').classList.toggle('hidden',whatsappReady===0);
    const threshold=Math.max(1,Number(state.settings?.reminderDays)||14);
    $('#late-caption').textContent=`Más de ${threshold} días desde su vencimiento`;
    $('#late-empty-caption').textContent=`No hay cuotas con más de ${threshold} días de atraso.`;
    renderLate(); renderRecent(); renderStudents(); renderDues(); renderReceipts(); renderPaymentSelect();
    $('#today-label').textContent=new Date().toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).replace('.', '');
  }
  function renderLate() {
    const late=state.students.filter(s=>studentStatus(s).key==='late').sort((a,b)=>dayDiff(dueISO(b))-dayDiff(dueISO(a)));
    $('#late-table').innerHTML=late.slice(0,5).map((s,i)=>`<tr><td>${person(s,i)}</td><td>${escapeHTML(s.plan||'—')}</td><td>${formatDate(dueISO(s))}</td><td class="late-days">${studentStatus(s).detail}</td><td>${whatsappAction(s)}<button class="row-action" title="Registrar pago" data-pay="${s.id}">＋</button></td></tr>`).join('');
    $('#late-empty').classList.toggle('hidden',late.length>0); $('.attention-panel .table-wrap').classList.toggle('hidden',late.length===0);
  }
  function paymentRow(p, compact=false) {
    const s=paymentStudent(p); if (!s) return '';
    return compact?`<div class="recent-item"><span class="pay-check">✓</span>${person(s,Math.abs(s.name.length))}<span class="recent-date">${formatDate(p.date)}</span><span class="recent-amount">${money(p.amount)}<small> ARS</small>${p.note?`<div class="recent-note">${escapeHTML(p.note)}</div>`:''}</span></div>`:'';
  }
  function renderRecent() {
    const list=sortedPayments().slice(0,4); $('#recent-list').innerHTML=list.map(p=>paymentRow(p,true)).join('');
    $('#payments-empty').classList.toggle('hidden',list.length>0); $('#recent-list').classList.toggle('hidden',list.length===0);
  }
  function rosterRows(items, type) {
    return items.map((s,i)=>`<tr><td>${person(s,i)}</td><td>${escapeHTML(s.plan||'—')}<br><small class="muted">${s.fee?money(s.fee):'Sin valor definido'}</small></td><td>${formatDate(s.lastPayment)}</td><td>${formatDate(dueISO(s))}</td><td>${statusPill(s)}</td><td>${whatsappAction(s)}<button class="row-action" title="Editar alumno" data-edit="${s.id}">✎</button><button class="row-action" title="Registrar pago" data-pay="${s.id}">＋</button></td></tr>`).join('');
  }
  function filterStudents(query, filter) {
    const q=query.trim().toLocaleLowerCase('es');
    return state.students.filter(s=>(!q||`${s.name} ${s.phone}`.toLocaleLowerCase('es').includes(q))&&(filter==='all'||studentStatus(s).key===filter));
  }
  function renderStudents() {
    const search=$('#student-search').value,filter=$('#student-filter').value,rows=filterStudents(search,filter);
    $('#student-table').innerHTML=rosterRows(rows,'students'); $('#students-empty').classList.toggle('hidden',rows.length>0); $('.roster-panel .table-wrap', $('#view-alumnos')).classList.toggle('hidden',rows.length===0);
  }
  function renderDues() {
    const counts={current:0,soon:0,grace:0,late:0,unpaid:0}; state.students.forEach(s=>counts[studentStatus(s).key]++);
    const threshold=Math.max(1,Number(state.settings?.reminderDays)||14);
    $('#due-summary').innerHTML=`<div class="sum-current"><b>${counts.current}</b><span>Al día</span></div><div class="sum-soon"><b>${counts.soon}</b><span>Vencen en 7 días</span></div><div class="sum-grace"><b>${counts.grace}</b><span>Vencidas · período de gracia</span></div><div class="sum-late"><b>${counts.late}</b><span>Más de ${threshold} días</span></div>`;
    const rows=filterStudents($('#due-search').value,$('#due-filter').value);
    $('#due-table').innerHTML=rosterRows(rows,'dues'); $('#dues-empty').classList.toggle('hidden',rows.length>0); $('.roster-panel .table-wrap',$('#view-cuotas')).classList.toggle('hidden',rows.length===0);
  }
  function renderPaymentSelect(selected='') {
    const select=$('#payment-student'); const previous=selected||select.value;
    select.innerHTML='<option value="">Seleccionar alumno…</option>'+state.students.slice().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(s=>`<option value="${s.id}">${escapeHTML(s.name)} · ${escapeHTML(s.plan||'Sin plan')}</option>`).join('');
    if (state.students.some(s=>s.id===previous)) select.value=previous;
  }
  function renderReceipts() {
    const q=$('#payment-search').value.trim().toLocaleLowerCase('es');
    const list=sortedPayments().filter(p=>{const s=paymentStudent(p);return s&&(!q||s.name.toLocaleLowerCase('es').includes(q));});
    $('#payment-total').textContent=`${list.length} ${list.length===1?'pago':'pagos'}`;
    $('#receipt-list').innerHTML=list.map(p=>{const s=paymentStudent(p);const thumb=p.receiptId?`<img class="receipt-thumb" data-image="${escapeHTML(p.receiptId)}" alt="Abrir comprobante" />`:'<span class="receipt-placeholder">▧</span>';return `<div class="receipt-row">${thumb}<div class="receipt-info"><b>${escapeHTML(s.name)}</b><span>${formatDate(p.date)}${p.note?` · ${escapeHTML(p.note)}`:''}</span></div><span class="receipt-amount">${money(p.amount)}</span>${p.receiptId?`<button class="receipt-detail" data-image="${escapeHTML(p.receiptId)}">Ver foto ↗</button>`:''}</div>`;}).join('');
    $('#receipts-empty').classList.toggle('hidden',list.length>0); $('#receipt-list').classList.toggle('hidden',list.length===0);
    list.filter(p=>p.receiptId).forEach(async p=>{const img=$(`[data-image="${p.receiptId}"]`,$('#receipt-list'));if(img&&img.tagName==='IMG'){const blob=await getFile(p.receiptId);if(blob){img.src=URL.createObjectURL(blob);img.dataset.loaded='1';}}});
  }

  function openDB() { return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore('receipts');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
  async function saveFile(id,blob) { try { const db=await openDB(); return await new Promise((resolve,reject)=>{const tx=db.transaction('receipts','readwrite');tx.objectStore('receipts').put(blob,id);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error)};}); } catch { return false; } }
  async function getFile(id) { try { const db=await openDB();return await new Promise((resolve,reject)=>{const req=db.transaction('receipts').objectStore('receipts').get(id);req.onsuccess=()=>{db.close();resolve(req.result||null)};req.onerror=()=>{db.close();reject(req.error)};}); } catch { return null; } }

  function showToast(message) { const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2800); }
  function setCloudStatus(message) { const el=$('#cloud-status');if(el)el.textContent=message; }
  function updateAccountUI() {
    if(!$('#reminders-enabled'))return;
    $('#reminders-enabled').checked=Boolean(state.settings?.whatsappRemindersEnabled);
    $('#reminder-days').value=Number(state.settings?.reminderDays)||14;
    $('#reminders-enabled').disabled=!remoteAuthenticated;
    $('#cloud-login').classList.toggle('hidden',remoteAuthenticated);
    $('#cloud-logout').classList.toggle('hidden',!remoteAuthenticated);
    $('#cloud-password').classList.toggle('hidden',remoteAuthenticated);
  }
  async function saveRemoteState() {
    if(!remoteAuthenticated||remoteLoading||state.demo)return false;
    remoteLoading=true;
    try{
      const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){if(response.status===401)remoteAuthenticated=false;setCloudStatus(result.error||'No se pudo sincronizar con Neon.');updateAccountUI();return false;}
      setCloudStatus(`Sincronizado con Neon · ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}.`);
      return true;
    }catch(e){setCloudStatus('Sin conexión. Los cambios quedan guardados en este dispositivo y se reintentarán al volver la conexión.');return false;}
    finally{remoteLoading=false;}
  }
  async function loadRemoteState() {
    if(!remoteAuthenticated)return false;
    remoteLoading=true;setCloudStatus('Cargando datos compartidos desde Neon…');
    let response,result;
    try{response=await fetch('/api/state');result=await response.json();}catch(e){remoteLoading=false;setCloudStatus('No se pudo conectar con Neon.');return false;}
    if(!response.ok){if(response.status===401)remoteAuthenticated=false;remoteLoading=false;setCloudStatus(result.error||'Error al leer los datos compartidos.');updateAccountUI();return false;}
    if(result.data){state=normalizeState(result.data);state.demo=false;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));remoteLoading=false;render();setCloudStatus('Conectado a Neon. Los datos están sincronizados.');updateAccountUI();return true;}
    if(state.demo){const settings={...state.settings};state={students:[],payments:[],settings,demo:false};}
    else state.demo=false;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));remoteLoading=false;render();const saved=await saveRemoteState();updateAccountUI();return saved;
  }
  async function setupRemoteSync() {
    try{
      const response=await fetch('/api/auth/session',{cache:'no-store'});if(!response.ok)return;
      const result=await response.json();
      if(result.authenticated){remoteAuthenticated=true;if(!(await loadRemoteState()))remoteAuthenticated=false;}
      else setCloudStatus('Modo local. Iniciá sesión con la contraseña administradora para sincronizar con Neon.');
      updateAccountUI();
    }catch(e){setCloudStatus('Modo local. La sincronización se activa al publicar en Vercel con Neon.');}
  }
  function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1); }
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function isStandalone() { return navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches; }
  function openInstallGuide() {
    $('#install-android').classList.remove('hidden');
    $('#install-iphone').classList.remove('hidden');
    $('#install-desktop').classList.toggle('hidden',isAndroid()||isIOS());
    $('#start-install').classList.toggle('hidden',!(isAndroid()&&deferredInstallPrompt));
    if(isAndroid()&&deferredInstallPrompt)$('#android-auto-copy').textContent='Tu navegador permite instalar Lubox Cross directamente.';
    $('#install-modal').showModal();
  }
  async function installApp() {
    if(!deferredInstallPrompt)return;
    deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    if(choice?.outcome==='accepted')showToast('Instalación iniciada.');
    $('#start-install').classList.add('hidden');
  }
  function setView(name) {
    $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    const labels={inicio:'Resumen',alumnos:'Alumnos',cuotas:'Cuotas',comprobantes:'Comprobantes'};
    $('#crumb-current').textContent=labels[name]||'Resumen'; $('#sidebar').classList.remove('open');
    if(location.hash!==`#${name}`) history.replaceState(null,'',`#${name}`);
  }
  function openStudent(student=null) {
    $('#student-form').reset(); $('#student-id').value=student?.id||'';
    $('#student-last-payment').max=localISO();
    $('#student-modal-title').textContent=student?'Editar alumno':'Nuevo alumno';
    $('#student-name').value=student?.name||'';$('#student-phone').value=student?.phone||'';$('#student-plan').value=student?.plan||'';$('#student-fee').value=student?.fee||'';$('#student-last-payment').value=student?.lastPayment||'';
    $('#student-whatsapp-optin').checked=Boolean(student?.whatsappOptIn);
    $('#student-modal').showModal();
  }
  function openPayment(studentId='') {
    if(!state.students.length){showToast('Primero agregá un alumno para registrar un pago.');openStudent();return;}
    resetPaymentForm(); renderPaymentSelect(studentId);$('#payment-date').value=localISO();$('#payment-date').max=localISO();$('#payment-amount').value=state.students.find(s=>s.id===studentId)?.fee||'';$('#payment-modal').showModal();
  }
  function resetPaymentForm() {
    $('#payment-form').reset(); selectedFile=null;
    if(selectedPreviewUrl)URL.revokeObjectURL(selectedPreviewUrl);selectedPreviewUrl=null;
    $('#upload-empty').classList.remove('hidden');$('#upload-preview').classList.add('hidden');$('#receipt-file').value='';$('#ocr-status').textContent='Imagen lista para revisar';
  }
  function compressImage(file) {
    return new Promise(resolve=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,1400/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{URL.revokeObjectURL(url);resolve(blob||file)},'image/jpeg',.76)};img.onerror=()=>{URL.revokeObjectURL(url);resolve(file)};img.src=url;});
  }
  function normalize(text) { return text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }
  function extractReceiptDate(text) {
    const patterns=[/(\b\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g,/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/g];
    for(const m of text.matchAll(patterns[0])){const d=+m[1],mo=+m[2],y=+m[3];if(d>0&&d<=31&&mo>0&&mo<=12)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
    for(const m of text.matchAll(patterns[1])){const y=+m[1],mo=+m[2],d=+m[3];if(d>0&&d<=31&&mo>0&&mo<=12)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
    return '';
  }
  function recognizeStudent(text) {
    const normalized=normalize(text);let best=null,score=0;
    for(const s of state.students){const full=normalize(s.name);if(full.length>5&&normalized.includes(full))return s;const parts=full.split(' ').filter(p=>p.length>2);const matched=parts.filter(p=>normalized.includes(p)).length;const ratio=parts.length?matched/parts.length:0;if(ratio>score&&ratio>=.67){best=s;score=ratio;}}
    return best;
  }
  function extractAmount(text) {
    const matches=[...text.matchAll(/(?:\$\s*)?\b(\d{1,3}(?:[.,]\d{3})+|\d{4,7})(?:[.,]\d{2})?\b/g)].map(m=>Number(m[1].replace(/[.,]/g,''))).filter(n=>n>=5000&&n<=2000000);
    return matches.length?Math.max(...matches):null;
  }
  async function runOCR(file) {
    const status=$('#ocr-status');
    if(!window.Tesseract){status.textContent='No se pudo iniciar OCR; completá los datos manualmente.';return;}
    status.textContent='Leyendo comprobante… puede tardar unos segundos';
    try{
      const worker=await Tesseract.createWorker('spa');const result=await worker.recognize(file);await worker.terminate();if(selectedFile!==file)return;const text=result.data.text||'';
      let found=0;const student=recognizeStudent(text);if(student){$('#payment-student').value=student.id;$('#payment-amount').value=student.fee||$('#payment-amount').value;found++;}
      const date=extractReceiptDate(text);if(date){$('#payment-date').value=date;found++;}
      const amount=extractAmount(text);if(amount){$('#payment-amount').value=amount;found++;}
      status.textContent=found?`Lectura sugerida · ${found} dato${found===1?'':'s'} detectado${found===1?'':'s'}; revisá antes de guardar`:'No encontramos nombre, fecha o monto con claridad. Completalos manualmente.';
    }catch(e){if(selectedFile===file)status.textContent='No se pudo leer automáticamente; completá los datos manualmente.';}
  }
  async function selectReceipt(file) {
    if(!file)return;if(!file.type.startsWith('image/')){showToast('Elegí una imagen JPG o PNG.');return;}
    selectedFile=await compressImage(file);selectedPreviewUrl=URL.createObjectURL(selectedFile);
    $('#receipt-preview').src=selectedPreviewUrl;$('#receipt-filename').textContent=file.name;$('#upload-empty').classList.add('hidden');$('#upload-preview').classList.remove('hidden');
    runOCR(selectedFile);
  }

  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.view)setView(b.dataset.view);else if(b.id==='reminders-nav'){updateAccountUI();$('#account-modal').showModal();}}));
  $$('[data-goto]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.goto)));
  $('#menu-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#account-open').addEventListener('click',()=>{updateAccountUI();$('#account-modal').showModal();});
  $('#cloud-login').addEventListener('click',async()=>{
    const password=$('#cloud-password').value;
    if(!password){setCloudStatus('Ingresá la contraseña administradora configurada en Vercel.');return;}
    setCloudStatus('Conectando…');
    try{
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){setCloudStatus(result.error||'No se pudo iniciar sesión.');return;}
      remoteAuthenticated=true;const synced=await loadRemoteState();if(!synced){remoteAuthenticated=false;await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});updateAccountUI();return;}updateAccountUI();$('#cloud-password').value='';showToast('Conectado a Neon.');
    }catch(e){setCloudStatus('No se pudo conectar. Revisá la publicación en Vercel.');}
  });
  $('#cloud-logout').addEventListener('click',async()=>{
    if(cloudSaveTimer){clearTimeout(cloudSaveTimer);await saveRemoteState();}
    await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});remoteAuthenticated=false;updateAccountUI();setCloudStatus('Sesión cerrada. Los cambios nuevos quedan en este dispositivo.');
  });
  $('#account-form').addEventListener('submit',e=>{
    e.preventDefault();const days=Number($('#reminder-days').value);
    if(!Number.isInteger(days)||days<1||days>180){showToast('Elegí un plazo entre 1 y 180 días.');return;}
    state.settings={...state.settings,reminderDays:days,whatsappRemindersEnabled:$('#reminders-enabled').checked};
    if(!state.demo)persist();else localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    render();$('#account-modal').close();showToast(remoteAuthenticated?'Configuración sincronizada.':'Plazo de aviso guardado en este dispositivo.');
  });
  $('#install-app').addEventListener('click',()=>{if(deferredInstallPrompt){installApp();return;}openInstallGuide();});
  $('#start-install').addEventListener('click',installApp);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;$('#install-app').classList.add('hidden');showToast('Lubox Cross quedó instalada.');});
  $$('[data-open="student"]').forEach(b=>b.addEventListener('click',()=>openStudent()));
  $$('[data-open="payment"]').forEach(b=>b.addEventListener('click',()=>openPayment()));
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $('#student-search').addEventListener('input',renderStudents);$('#student-filter').addEventListener('change',renderStudents);
  $('#due-search').addEventListener('input',renderDues);$('#due-filter').addEventListener('change',renderDues);$('#payment-search').addEventListener('input',renderReceipts);
  document.addEventListener('click',e=>{
    const pay=e.target.closest('[data-pay]');if(pay){openPayment(pay.dataset.pay);return;}
    const edit=e.target.closest('[data-edit]');if(edit){const student=state.students.find(s=>s.id===edit.dataset.edit);if(student)openStudent(student);return;}
    const image=e.target.closest('[data-image]');if(image){const id=image.dataset.image;getFile(id).then(blob=>{if(!blob){showToast('No encontramos este archivo en el dispositivo.');return;}const url=URL.createObjectURL(blob);$('#large-image').src=url;const payment=state.payments.find(p=>p.receiptId===id),student=payment&&paymentStudent(payment);$('#image-caption').textContent=student?`${student.name} · ${formatDate(payment.date)} · ${money(payment.amount)}`:'Comprobante';$('#image-modal').showModal();$('#image-modal').addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});});}
  });
  $('#student-form').addEventListener('submit',e=>{
    e.preventDefault();const id=$('#student-id').value;
    const existing=state.students.find(s=>s.id===id);
    const digits=whatsappNumber($('#student-phone').value.trim());
    const accepted=$('#student-whatsapp-optin').checked;
    const student={id:id||`s${crypto.randomUUID()}`,name:$('#student-name').value.trim(),phone:digits?`+${digits}`:'',plan:$('#student-plan').value.trim(),fee:Number($('#student-fee').value)||0,lastPayment:$('#student-last-payment').value||'',whatsappOptIn:accepted,whatsappOptInAt:accepted?(existing?.whatsappOptInAt||localISO()):'',lastReminderForDueDate:existing?.lastReminderForDueDate||''};
    if(id){const i=state.students.findIndex(s=>s.id===id);if(i>=0)state.students[i]=student;}else state.students.push(student);
    state.demo=false;
    persist();render();$('#student-modal').close();showToast(id?'Datos del alumno actualizados.':'Alumno agregado.');
  });
  $('#payment-form').addEventListener('submit',async e=>{
    e.preventDefault();const studentId=$('#payment-student').value;const student=state.students.find(s=>s.id===studentId);if(!student)return;
    const id=`p${crypto.randomUUID()}`,receiptId=selectedFile?`r${crypto.randomUUID()}`:null;
    if(selectedFile){const saved=await saveFile(receiptId,selectedFile);if(!saved){showToast('No se pudo guardar la foto; probá con una imagen más chica.');return;}}
    const payment={id,studentId,date:$('#payment-date').value,amount:Number($('#payment-amount').value),note:$('#payment-note').value.trim(),receiptId};
    state.payments.push(payment);
    if(!student.lastPayment||payment.date>=student.lastPayment)student.lastPayment=payment.date;
    state.demo=false;
    persist();resetPaymentForm();$('#payment-modal').close();render();showToast('Pago registrado y cuota actualizada.');
  });
  $('#choose-file').addEventListener('click',()=>$('#receipt-file').click());$('#receipt-file').addEventListener('change',e=>selectReceipt(e.target.files[0]));
  const upload=$('#upload-box');upload.addEventListener('dragover',e=>{e.preventDefault();upload.style.borderColor='var(--cyan)'});upload.addEventListener('dragleave',()=>upload.style.borderColor='');upload.addEventListener('drop',e=>{e.preventDefault();upload.style.borderColor='';selectReceipt(e.dataTransfer.files[0]);});
  $('#remove-file').addEventListener('click',()=>{selectedFile=null;if(selectedPreviewUrl)URL.revokeObjectURL(selectedPreviewUrl);selectedPreviewUrl=null;$('#receipt-file').value='';$('#upload-preview').classList.add('hidden');$('#upload-empty').classList.remove('hidden')});
  $('#student-name').addEventListener('input',()=>{});
  $('#reset-demo').addEventListener('click',()=>{if(remoteAuthenticated){showToast('Desconectá la cuenta para restaurar los datos de ejemplo.');return;}state=seedState();persist();render();setView('inicio');showToast('Se restauraron los datos de ejemplo.');});
  window.addEventListener('hashchange',()=>{const name=location.hash.slice(1);if(['inicio','alumnos','cuotas','comprobantes'].includes(name))setView(name)});
  const initial=location.hash.slice(1);setView(['inicio','alumnos','cuotas','comprobantes'].includes(initial)?initial:'inicio');render();
  updateAccountUI();setupRemoteSync();
  window.addEventListener('online',()=>{if(remoteAuthenticated&&!state.demo)saveRemoteState();});
  if(isStandalone())$('#install-app').classList.add('hidden');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
