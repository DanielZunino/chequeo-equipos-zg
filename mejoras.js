/* MEJORAS CHEQUEO DE EQUIPOS ZG · Creado por Daniel Zunino · Integra Prevención SpA
   - Documentos: foto + fecha SOLO la primera vez; silencio mientras estén vigentes; aviso a 15 días; se piden de nuevo al vencer.
   - Identificación más corta (equipo de siempre, datos recordados).
   - Plataforma fluida (sin recargar la pantalla en cada toque).
   - Envío en cola: funciona sin internet, por partes, con reintentos y sin duplicados. */
(function () {
  'use strict';
  if (typeof S === 'undefined' || typeof render !== 'function') return;
  const DIAS_DOC = 15, PREF = 'zg_cache_', NOMD = { soap: 'Seguro obligatorio (SOAP)', permiso: 'Permiso de circulación', rt: 'Revisión técnica' }, KD = ['soap', 'permiso', 'rt'];
  const st = document.createElement('style');
  st.textContent = '.docok{background:#E3F4E4;border-radius:12px;padding:10px 12px;margin-top:10px}.docw{background:#FFF0E0;border-radius:12px;padding:10px 12px;margin-top:10px}.doc{margin-top:4px}.doc .ph{margin-top:6px}#net{position:fixed;left:50%;transform:translateX(-50%);top:72px;z-index:30;background:#E65100;color:#fff;font-weight:700;font-size:13px;padding:6px 14px;border-radius:99px;box-shadow:0 3px 10px #0004;display:none;max-width:92vw;text-align:center}.toast{position:fixed;left:16px;right:16px;bottom:90px;z-index:31;max-width:600px;margin:auto;box-shadow:0 4px 18px #0003}';
  document.head.appendChild(st);
  const net = document.createElement('div'); net.id = 'net'; net.textContent = '📵 Sin internet: puedes seguir; se guarda en tu teléfono'; document.body.appendChild(net);
  const pintaNet = () => { net.style.display = navigator.onLine ? 'none' : 'block'; };
  addEventListener('offline', pintaNet); addEventListener('online', () => { pintaNet(); flush(); }); pintaNet();
  const toast = (t, ok) => { const d = document.createElement('div'); d.className = 'info toast' + (ok ? '' : ' x'); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3600); };

  // ---------- almacenamiento local (IndexedDB con respaldo en memoria)
  const mem = {};
  const idb = (() => { let db;
    const open = () => db ? Promise.resolve(db) : new Promise((ok, no) => { const r = indexedDB.open('zg_chequeo', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { db = r.result; ok(db); }; r.onerror = () => no(r.error); });
    const tx = (m, f) => open().then(d => new Promise((ok, no) => { const t = d.transaction('kv', m), q = f(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); }));
    return { get: k => tx('readonly', s => s.get(k)).catch(() => mem[k]), set: (k, v) => { mem[k] = v; return tx('readwrite', s => s.put(v, k)).catch(() => {}); }, del: k => { delete mem[k]; return tx('readwrite', s => s.delete(k)).catch(() => {}); }, keys: () => tx('readonly', s => s.getAllKeys()).catch(() => Object.keys(mem)) }; })();

  // ---------- red: tiempo máximo + caché de lecturas (para trabajar sin internet)
  const conTimeout = (url, opt, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, Object.assign({ signal: c.signal }, opt)).finally(() => clearTimeout(t)); };
  const _api = window.api;
  window.api = async function (fn, arg) {
    if (fn === 'apiGuardar') return enviarCola(arg);
    const url = SCRIPT_URL + '?' + new URLSearchParams(RUTAS[fn](arg)), ck = PREF + fn + '_' + (typeof arg === 'string' ? arg : '');
    try {
      const d = await (await conTimeout(url, {}, 15000)).json();
      if (d && d.ok) { try { localStorage.setItem(ck, JSON.stringify(d)); } catch (e) {} }
      if (fn === 'apiEquipo' && d && d.ok && !d.nuevo && d.ultimo) KD.forEach(k => { const dv = dias(d.ultimo[k]); if (dv != null && dv < 0) d.ultimo[k] = ''; });   // vencido: se pide de nuevo
      if (fn === 'apiOperador' && d && d.ok) { try { const u = JSON.parse(localStorage.getItem('zg_ult_' + d.persona.id)); if (u) api('apiEquipo', u.patente).catch(() => {}); } catch (e) {} }
      return d;
    } catch (e) {
      let c = null; try { c = JSON.parse(localStorage.getItem(ck)); } catch (x) {}
      if (c) { c._cache = true; if (fn === 'apiEquipo' && !c.nuevo && c.ultimo) KD.forEach(k => { const dv = dias(c.ultimo[k]); if (dv != null && dv < 0) c.ultimo[k] = ''; }); return c; }
      throw e;
    }
  };

  // ---------- envío en cola (por partes, con reintentos, sin duplicados)
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
  let PEND = 0; const enCurso = {}, enLinea = new Set();
  async function post(o, ms) { let err; for (let k = 0; k < 3; k++) { try { return await (await conTimeout(SCRIPT_URL, { method: 'POST', body: JSON.stringify(o) }, ms || 20000)).json(); } catch (e) { err = e; if (!navigator.onLine) break; await new Promise(r => setTimeout(r, 700 * (k + 1))); } } throw err; }
  function intentar(id) {
    if (enCurso[id]) return enCurso[id];
    const p = (async () => {
      try {
        if (!navigator.onLine) return null;
        const rec = mem['out_' + id] || await idb.get('out_' + id); if (!rec) return null;
        rec.sent = rec.sent || {}; const txt = JSON.stringify(rec.body), N = 45000, n = Math.ceil(txt.length / N);
        for (let i = 0; i < n; i++) { if (rec.sent[i]) continue; const r = await post({ api: 'parte', envio: id, i, n, d: txt.slice(i * N, (i + 1) * N) }); if (!r || !r.ok) throw 'parte'; rec.sent[i] = 1; await idb.set('out_' + id, rec); prog(i + 1, n); }
        const d = await post({ api: 'commit', envio: id, n }, 70000);
        if (d && d.ok) { await idb.del('out_' + id); PEND = Math.max(0, PEND - 1); return d; }
        if (d && d.faltan) { d.faltan.forEach(i => delete rec.sent[i]); await idb.set('out_' + id, rec); }
        return null;
      } catch (e) { return null; } finally { delete enCurso[id]; }
    })();
    enCurso[id] = p; p.then(d => { if (d) alListo(id, d); }); return p;
  }
  const prog = (i, n) => { const e = document.getElementById('prog-env'); if (e) e.textContent = 'Enviando… ' + Math.round(i / n * 100) + '%'; };
  async function enviarCola(body) {
    const id = S._envio || (S._envio = uid()); body.envio = id;
    if (S.docFoto && Object.keys(S.docFoto).length) body.docFotos = S.docFoto;
    clearTimeout(_gt); await idb.set('out_' + id, { id, body, t: Date.now() }); idb.del('draft_media'); PEND++; enLinea.add(id);
    let d = null; try { d = await Promise.race([intentar(id), new Promise(r => setTimeout(() => r(null), 22000))]); } finally { enLinea.delete(id); }
    return d || { ok: true, pendiente: true, codigo: '', link: '', enviados: [], sinCorreo: [], nuevo: false, _envio: id };
  }
  function alListo(id, d) {
    if (S.fin && S.fin.pendiente && S.fin._envio === id) { S.fin = Object.assign({}, d, { resultado: S.fin.resultado }); $('#app').innerHTML = vFin(); VOZ.say('Tu chequeo se envió correctamente.'); }
    else if (!enLinea.has(id)) toast('✅ Chequeo pendiente enviado' + (d.codigo ? ': ' + d.codigo : ''), true);
  }
  async function flush() { if (!navigator.onLine) return; const ks = (await idb.keys()).filter(k => String(k).startsWith('out_')); PEND = ks.length; ks.forEach(k => intentar(String(k).slice(4))); }
  window.reintentarEnvio = () => { toast('Intentando enviar…', true); flush(); };
  setInterval(flush, 20000); setTimeout(flush, 1500);

  const _say = VOZ.say; VOZ.say = function (t, e) { if (S.fin && S.fin.pendiente && /Chequeo enviado/.test(t)) t = 'Chequeo guardado en tu teléfono. Se enviará solo cuando tengas internet.'; return _say(t, e); };
  const _vFin = window.vFin;
  window.vFin = function () { const f = S.fin || {};
    if (!f.ok) return '<div class="card center"><div class="spin"></div><p>Enviando informe…</p><div id="prog-env" class="mut small"></div><p class="small mut">Si no hay buena señal, se guarda en tu teléfono y se envía solo.</p></div>';
    if (f.pendiente) return '<div class="card center"><div class="big">📲</div><h2>Chequeo guardado en tu teléfono</h2><p class="m">Aún no hay buena señal. <b>Se enviará solo</b> apenas tengas internet. Puedes cerrar la app o revisar otro equipo.</p><div class="info" id="prog-env">Pendiente de envío…</div><div style="height:10px"></div><button class="btn am" onclick="reintentarEnvio()">Reintentar ahora</button><div style="height:10px"></div><button class="btn gh" onclick="nuevo()">Revisar otro equipo</button></div>';
    return _vFin(); };
  const _vInicio = window.vInicio;
  window.vInicio = function () { const h = _vInicio(); return (PEND ? '<div class="info w" style="margin-bottom:12px">📲 Tienes ' + PEND + ' chequeo(s) guardado(s) esperando internet. Se envían solos.</div>' : '') + h; };

  // ---------- borrador liviano (las fotos van a IndexedDB, no al localStorage)
  let _gt;
  const guardaYa = () => { if (S.paso >= pasoFin()) return; try { const c = Object.assign({}, S); ['fin', 'enviando', 'personas', 'fotos', 'fotoEq', 'firma', 'docFoto', '_ultVoz'].forEach(k => delete c[k]); localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} idb.set('draft_media', { fotos: S.fotos, fotoEq: S.fotoEq, firma: S.firma, docFoto: S.docFoto }); };
  window.guarda = function () { clearTimeout(_gt); _gt = setTimeout(guardaYa, 400); };
  addEventListener('pagehide', guardaYa); document.addEventListener('visibilitychange', () => { if (document.hidden) guardaYa(); });
  const _seguir = window.seguir;
  window.seguir = async function () { _seguir(); const m = await idb.get('draft_media'); if (m) { Object.assign(S, { fotos: m.fotos || {}, fotoEq: m.fotoEq || '', firma: m.firma || '', docFoto: m.docFoto || {} }); render(); } };
  const _desc = window.descartar; window.descartar = function () { idb.del('draft_media'); S._envio = null; _desc(); };

  // ---------- fotos más livianas y rápidas
  async function comprime(file, max, q) {
    let src, w, h;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
    catch (e) { src = await new Promise((ok, no) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); ok(im); }; im.onerror = no; im.src = u; }); w = src.width; h = src.height; }
    const r = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  }
  window.achica = (file, cb) => comprime(file, 900, 0.65).then(cb).catch(() => toast('No se pudo leer la foto. Intenta de nuevo.'));

  // ---------- toques sin recargar la pantalla
  function pintaItem(k) {
    const v = S.res[k] || '', box = document.getElementById('it-' + k.replace('.', '-')); if (!box) return;
    box.className = 'item' + (v ? ' v-' + v : '');
    box.querySelectorAll('.opts button').forEach(b => { const m = /'(B|R|M|NA)'\)/.exec(b.getAttribute('onclick') || ''), x = m && m[1]; b.className = x && x === v ? 'on ' + x : ''; });
    const det = box.querySelector('.det'); if (!det) return; det.classList.toggle('on', v === 'R' || v === 'M'); det.querySelectorAll('.info.x').forEach(e => e.remove());
    const [bid, iid] = k.split('.'), b = bloques().find(x => x.id === bid), it = b && b.items.find(x => x.id === iid);
    if (v === 'M' && it && it.crit) { const d = document.createElement('div'); d.className = 'info x'; d.style.marginTop = '8px'; d.innerHTML = '🛑 <b>Ítem crítico en mal estado:</b> el equipo NO debe operar hasta que se repare.'; det.appendChild(d); }
  }
  window.marca = function (k, v) {
    S.res[k] = v; pintaItem(k); guarda(); guia(true);
    if (v === 'R' || v === 'M') setTimeout(() => { const t = document.querySelector('#it-' + k.replace('.', '-') + ' textarea'); if (t && !t.value) t.focus({ preventScroll: true }); }, 300);
    const [bid, iid] = k.split('.'), b = bloques().find(x => x.id === bid), it = b.items.find(x => x.id === iid);
    if (v === 'M' && it.crit) VOZ.say('Atención. ' + it.t + ' es un punto crítico. Si está malo, el equipo no debe operar. Cuenta qué encontraste y saca una foto.');
    else if (v === 'R' || v === 'M') VOZ.say('Cuenta brevemente qué encontraste.');
    else if (b.items.every(x => S.res[bid + '.' + x.id])) VOZ.say('¡Bien! Terminaste esta parte. Toca siguiente.');
    else VOZ.stop();
  };
  window.todoBien = function (bid) { const b = bloques().find(x => x.id === bid); b.items.forEach(it => { const k = bid + '.' + it.id; if (!S.res[k]) { S.res[k] = 'B'; pintaItem(k); } }); guarda(); guia(true); };
  const phHtml = (f, fn, txt) => '<label>📷 ' + (f ? 'Cambiar foto' : txt) + '<input type="file" accept="image/*" capture="environment" class="hide" onchange="' + fn + '(this)"></label>' + (f ? '<img src="data:image/jpeg;base64,' + f + '">' : '');
  window.foto = function (k, inp) { const file = inp.files && inp.files[0]; if (!file) return;
    if (!S.fotos[k] && Object.keys(S.fotos).length >= 6) { alertaUI('Máximo 6 fotos por chequeo.'); return; }
    window.achica(file, b => { S.fotos[k] = b; const ph = document.querySelector('#it-' + k.replace('.', '-') + ' .ph'); if (ph) ph.innerHTML = phHtml(b, "foto('" + k + "',", 'Agregar foto').replace(/foto\('([^']+)',\(this\)/, "foto('$1',this)"); guarda(); }); };
  window.fotoEquipo = function (inp) { const file = inp.files && inp.files[0]; if (!file) return; window.achica(file, b => { S.fotoEq = b; const ph = document.querySelector('.nuevo .ph'); if (ph) ph.innerHTML = phHtml(b, 'fotoEquipo', 'Foto del equipo'); guarda(); }); };
  window.togRep = function (k) { const i = S.rep.indexOf(k); if (i >= 0) S.rep.splice(i, 1); else S.rep.push(k); const on = S.rep.indexOf(k) >= 0;
    document.querySelectorAll('.who:not(.lock)').forEach(w => { if ((w.getAttribute('onclick') || '').indexOf("'" + k + "'") >= 0) { w.classList.toggle('on', on); w.querySelector('.ck').textContent = on ? '✓' : ''; } }); guarda(); };

  // ---------- identificación más corta
  const resetDoc = () => { S.docFoto = {}; S.docEdit = {}; };
  resetDoc();
  const _elT = window.elegirTipo; window.elegirTipo = function (t) { if (S.tipo !== t) resetDoc(); S._edit = 0; _elT(t); };
  const _nuevo = window.nuevo; window.nuevo = function () { resetDoc(); S._envio = null; S._edit = 0; _nuevo(); };
  const _pick = window.pickPat;
  window.pickPat = async function (v) {
    if (v !== S.patente) { resetDoc(); Object.assign(S, { soap: '', permiso: '', rt: '', prox: '', marca: '', anio: '', rampla: '', km: '' }); }
    S._edit = 0; await _pick(v);
    if (S.patente && !S.nuevoEq) { try { localStorage.setItem('zg_ult_' + S.persona.id, JSON.stringify({ tipo: S.tipo, patente: S.patente })); } catch (e) {} }
  };
  const _vTipo = window.vTipo;
  window.vTipo = function () { let h = _vTipo(), u = null; try { u = JSON.parse(localStorage.getItem('zg_ult_' + S.persona.id)); } catch (e) {}
    const eq = u && S.equipos.find(x => x.t === u.tipo && patKey(x.p) === patKey(u.patente));
    if (eq && !S.tipo) { const card = '<div class="card"><h3>⚡ Mi equipo de siempre</h3><button class="eq" onclick="atajo()">' + SVG[eq.t] + '<div><b>' + esc(TIPOS[eq.t].t) + ' ' + esc(eq.p) + '</b><span>' + esc(eq.m || '') + '</span><span class="sug">Toca para empezar el chequeo</span></div></button></div>';
      const i = h.indexOf('<div class="card"><h3>¿Qué equipo'); if (i >= 0) h = h.slice(0, i) + card + h.slice(i); }
    return h; };
  window.atajo = async function () { let u = null; try { u = JSON.parse(localStorage.getItem('zg_ult_' + S.persona.id)); } catch (e) {} if (!u) return; window.elegirTipo(u.tipo); S.paso = 2; await window.pickPat(u.patente); };
  const miles = el => { const d = el.value.replace(/\D/g, '').slice(0, 7); el.value = d.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  window.miles = miles;
  function vDatos() {
    const T = TIPOS[S.tipo];
    const fa = '<label class="l">Faena o lugar de trabajo</label><input value="' + esc(S.faena) + '" placeholder="Ej: Predio Los Robles, Cabrero" oninput="S.faena=this.value;try{localStorage.setItem(\'zg_faena\',this.value)}catch(e){};guarda()">';
    if (S.nuevoEq) return fa;
    if (S.patente && S.faena.trim() && (!T.rampla || S.rampla) && !S._edit)
      return '<div class="info" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">📍 <b>' + esc(S.faena) + '</b>' + (T.rampla ? ' · Rampla <b>' + esc(patKey(S.rampla)) + '</b>' : '') + (S.marca ? ' · ' + esc(S.marca) : '') + '<button class="why" style="margin-left:auto" onclick="editaDatos()">Cambiar</button></div>';
    return (T.rampla ? '<label class="l">Patente de la rampla / batea</label><input value="' + esc(S.rampla) + '" placeholder="Ej: JN6564" style="text-transform:uppercase" oninput="S.rampla=this.value;guarda()">' : '') + fa;
  }
  window.editaDatos = () => { S._edit = 1; $('#datos').innerHTML = vDatos(); };
  window.vEquipo = function () {
    const T = TIPOS[S.tipo], lista = S.equipos.filter(x => x.t === S.tipo).sort((a, b) => a.p.localeCompare(b.p)), info = S.eqInfo, U = info && info.ultimo;
    return '<div class="card"><div class="bh"><div class="ic">' + (VEH(S.tipo) ? '🚛' : '🌲') + '</div><div><h2>Datos del equipo</h2><div class="mut small">' + T.t + '</div></div></div>' +
      '<label class="l">' + (VEH(S.tipo) ? 'Patente' : 'Código o número del equipo') + '</label><select onchange="pickPat(this.value)"><option value="">— Elige de la lista —</option>' +
      lista.map(x => '<option value="' + esc(x.p) + '" ' + (!S.nuevoEq && patKey(S.patente) === patKey(x.p) ? 'selected' : '') + '>' + esc(x.p) + (x.m ? ' · ' + esc(x.m) : '') + (x.e === 'Pendiente' ? ' · ⏳ por verificar' : '') + (x.al ? ' · ⚠️' + x.al : '') + '</option>').join('') +
      '<option value="__nuevo" ' + (S.nuevoEq ? 'selected' : '') + '>➕ Mi equipo no está en la lista</option></select>' +
      (!lista.length && !S.nuevoEq ? '<div class="info">Aún no hay equipos de este tipo inscritos. Elige <b>➕ Mi equipo no está en la lista</b> para agregarlo.</div>' : '') +
      (S.nuevoEq ? vNuevo() : '<div id="eqinfo">' + (info ? vEqInfo(info) : '') + '</div>') + '<div id="datos">' + vDatos() + '</div>' +
      '<div class="row2"><div><label class="l">' + (T.med === 'km' ? 'Kilometraje actual' : 'Horómetro actual') + '</label><input inputmode="numeric" value="' + esc(S.km) + '" placeholder="' + (U && U.km ? 'Último: ' + esc(U.km) : (T.med === 'km' ? 'km' : 'horas')) + '" oninput="miles(this);S.km=this.value;pintaInd()"></div>' +
      '<div><label class="l">Próximo cambio de aceite</label><input inputmode="numeric" value="' + esc(S.prox) + '" placeholder="' + (T.med === 'km' ? 'km del adhesivo' : 'horas del adhesivo') + '" oninput="miles(this);S.prox=this.value;pintaInd()"></div></div>' +
      '<div id="ind">' + vInd() + '</div></div>' + vDocs();
  };

  // ---------- documentos: foto la primera vez, después silencio hasta 15 días antes del vencimiento
  const infoDoc = k => (S.eqInfo && S.eqInfo.docs && S.eqInfo.docs[k]) || null;
  function estDoc(k) {
    const inf = infoDoc(k), dv = dias(S[k]);
    if ((S.docFoto && S.docFoto[k]) || (S.docEdit && S.docEdit[k])) return 'edit';
    if (inf && inf.resp && dv != null && dv > DIAS_DOC) return 'ok';
    if (inf && inf.resp && dv != null && dv >= 0) return 'pronto';
    return 'falta';
  }
  function vDoc(k) {
    const e = estDoc(k), inf = infoDoc(k), dv = dias(S[k]), f = S.docFoto && S.docFoto[k], t = NOMD[k];
    if (e === 'ok') return '<div class="docok"><b>✅ ' + t + '</b><div class="small mut">Vigente hasta ' + esc(S[k]) + ' · respaldo guardado' + (inf && inf.resp !== true ? ' · <a href="' + esc(inf.resp) + '" target="_blank">ver</a>' : '') + '</div><button class="why" onclick="docEditar(\'' + k + '\')">Renovar documento</button></div>';
    if (e === 'pronto') return '<div class="docw"><b>⚠️ ' + t + '</b> <span class="badge b-w">vence en ' + dv + ' días</span><div class="small">Vence el ' + esc(S[k]) + '. Cuando lo renueves, sube el nuevo.</div><button class="btn gh" style="padding:9px;font-size:14px;margin-top:6px" onclick="docEditar(\'' + k + '\')">📷 Subir documento renovado</button></div>';
    return '<label class="l">' + t + '</label><div class="fecha-row"><input id="f-' + k + '" class="fecha" data-k="' + k + '" inputmode="numeric" maxlength="10" placeholder="DD-MM-AAAA" value="' + esc(S[k]) + '" oninput="mascaraFecha(this)"><span id="b-' + k + '">' + badgeFecha(S[k]) + '</span></div>' +
      '<div class="ph"><label>📷 ' + (f ? 'Cambiar foto' : 'Foto del documento') + '<input type="file" accept="image/*" capture="environment" class="hide" onchange="fotoDoc(\'' + k + '\',this)"></label>' + (f ? '<img src="data:image/jpeg;base64,' + f + '">' : '<span class="small mut">Obligatoria esta vez</span>') + '</div>' +
      (S.docEdit && S.docEdit[k] ? '<button class="why" onclick="docCancelar(\'' + k + '\')">Cancelar</button>' : '');
  }
  function vDocs() {
    if (!TIPOS[S.tipo].docs) return '';
    const todo = KD.every(k => estDoc(k) === 'ok');
    return '<div class="card" id="docs"><h3>📄 Documentos del vehículo</h3><p class="m">' + (todo ? '✅ Tus documentos ya están respaldados y vigentes: no hace falta subirlos otra vez.' : 'Saca una foto a cada documento y escribe su vencimiento. Se pide <b>solo esta vez</b>; después el sistema te avisa 15 días antes de que venza.') + '</p>' +
      KD.map(k => '<div class="doc" id="doc-' + k + '">' + vDoc(k) + '</div>').join('') + '</div>';
  }
  const pintaDoc = k => { const e = document.getElementById('doc-' + k); if (e) e.innerHTML = vDoc(k); guarda(); guia(true); };
  window.docEditar = k => { S.docEdit[k] = 1; pintaDoc(k); };
  window.docCancelar = k => { delete S.docEdit[k]; delete S.docFoto[k]; const i = infoDoc(k); if (i && i.f) S[k] = i.f; pintaDoc(k); };
  window.fotoDoc = (k, inp) => { const file = inp.files && inp.files[0]; if (!file) return; comprime(file, 1400, 0.72).then(b => { S.docFoto[k] = b; pintaDoc(k); }).catch(() => toast('No se pudo leer la foto. Intenta de nuevo.')); };
  const _val = window.validar;
  window.validar = function () { const e = _val(); if (e) return e;
    if (S.paso === 2 && TIPOS[S.tipo].docs) for (const k of KD) { const s = estDoc(k); if ((s === 'falta' || s === 'edit') && !(S.docFoto && S.docFoto[k])) return 'Falta la foto de: ' + NOMD[k] + '. Se pide solo esta vez.'; }
    return ''; };
  const _obj = window.objetivo;
  window.objetivo = function () { const r = _obj(); if (S.paso === 2 && r && r.id === 'bNext' && TIPOS[S.tipo].docs) for (const k of KD) { const s = estDoc(k); if ((s === 'falta' || s === 'edit') && !(S.docFoto && S.docFoto[k])) return document.querySelector('#doc-' + k + ' .ph label'); } return r; };
  const _ev = window.evaluar;
  window.evaluar = function () {
    const E = _ev(); if (!TIPOS[S.tipo].docs) return E;
    const NM = { 'SOAP': 'soap', 'Permiso de circulación': 'permiso', 'Revisión técnica': 'rt' };
    E.al = E.al.filter(a => { const k = NM[a.item]; if (!k || a.nivel !== 'Documento' || !/^Vence el/.test(a.det || '')) return true; const dv = dias(S[k]); return dv != null && dv <= DIAS_DOC; });
    const crit = E.al.some(a => a.nivel === 'Crítica'), med = E.al.some(a => a.nivel === 'Media' || a.nivel === 'Documento');
    E.resultado = crit ? 'NO APTO' : med ? 'APTO CON OBSERVACIONES' : 'APTO';
    E.mensaje = crit ? 'El equipo NO debe operar hasta corregir las fallas críticas. Avisa de inmediato a tu jefatura.' : med ? 'Puede operar con precaución. Las observaciones deben corregirse pronto.' : '¡Equipo en buenas condiciones! Buen trabajo revisándolo.';
    return E;
  };

  // ---------- abrir sin internet (service worker)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
