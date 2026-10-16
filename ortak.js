/* =========================================================
   Rahle — ortak kayıt kitaplığı (bilgisayarlar arası eşitleme; eski sitenin tools/yayin/ortak.js düzeni).

   Araştırma kaydı (Rahle'nin veri.* depo.* gunluk/gunlukArsiv + sarih.yorum/taslak, mesele.vakalar, kuyruk.ozel,
   tez.taslak.*, oku.mobilTaslak anahtarları) özel depodaki ayrı bir dalda (öntanımlı Ramazan9838/Rahle › ortak-kayit)
   JSON dosyaları olarak durur; GitHub Git Data API ile okunur ve yazılır, ana dala dokunulmaz. Birleştirme üç yolludur
   (son ortak sürüm / bu tarayıcı / depo): farklı fişlerde ve alanlarda yapılan değişiklikler birbirini ezmez; aynı alanı
   iki taraf farklı değiştirdiyse son eşitleyen (bu tarayıcı) geçer ve çakışma sayılır.

   Bu dosya saf kitaplıktır (DOM ve Rahle'ye bağlı değildir): giriş sayfası (araclar/yayin/giris.html) yükler ve Rahle'ye
   `window.__rahleOrtak.lib` olarak verir; eşitlemeyi Rahle içindeki parcalar/46_ortak-kayit.js yürütür. Node'da
   araclar/yayin/test/ altında sınanır (node --test araclar/yayin/test/ortak.test.js).

   "Durum" = {anahtar: değer}: yalnız paylaşılan anahtarlar; boş değerler (null, [], {}) yoktur; 'gunluk' bütün sicildir
   (gunlukArsiv + gunluk, zaman sırasında). Depoda dosya düzeni (ayir/topla):
     kayit/sema.json                    şema damgası
     kayit/genel.json                   küçük anahtarlar
     kayit/anahtar/<anahtar>.json       büyük (bölünemeyen) anahtar
     kayit/kova/<anahtar>/NN.json       fiş/ek gibi kod → kayıt nesneleri, koda göre KOVA dosyaya bölünür
     kayit/dizi/<anahtar>/NN.json       büyük kimlikli dizi (depo.*), kimliğe göre bölünür; sıra sira.json'da
     kayit/sicil/NNNN.json              sicil satırları, kanonik sırada 500'er satırlık bloklar
   Bir fişin değişmesi yalnız o fişin kovasını (ve sicilin son bloğunu) yeniler.
   ========================================================= */
(function (kok) {
  'use strict';

  var SEMA = 'rahle-ortak-1';
  var KLASOR = 'kayit/';
  var ESIK = 32 * 1024;                 // bundan büyük anahtar/dizi kendi dosyasına (ya da kovalara) ayrılır
  var KOVALI = { 'veri.fisler': 32, 'veri.ek': 32, 'veri.meseleler': 8 };   // kod → kayıt nesneleri
  var DIZI_KOVA = 16;
  var SICIL_BLOK = 500;
  var ARASTIRMA_RE = /^(veri\.|depo\.|gunluk$|gunlukArsiv$)/;
  var ARASTIRMA_EK_RE = /^(sarih\.(yorum|taslak)$|mesele\.vakalar$|kuyruk\.ozel$|tez\.taslak\.|oku\.mobilTaslak$)/;
  /* Çakışma sayılmayan yollar: türetilmiş alanlar (fisIndeksle yeniden hesaplar), iz damgaları, günlük sayım özeti.
     Aynı yerde iki taraf farklı yazdıysa yine bu tarayıcının değeri geçer, yalnız sayıya eklenmez. */
  var SAYILMAZ = { iz: 1, esik: 1, karineSayisi: 1, kuyrukSayim: 1 };
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  function paylasilirMi(k) { return ARASTIRMA_RE.test(k) || ARASTIRMA_EK_RE.test(k); }
  function duzNesne(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function bosMu(v) { return v == null || (Array.isArray(v) && !v.length) || (duzNesne(v) && !Object.keys(v).length); }

  // Anahtar sırasından bağımsız derin eşitlik.
  function esit(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!esit(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; });
    var kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) { if (!Object.prototype.hasOwnProperty.call(b, ka[j])) return false; if (!esit(a[ka[j]], b[ka[j]])) return false; }
    return true;
  }

  // Anahtarları sıralı JSON: aynı veri her zaman aynı metni verir (gereksiz commit olmaz).
  function sirala(v) {
    if (Array.isArray(v)) return v.map(sirala);
    if (!duzNesne(v)) return v;
    var o = {};
    Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = sirala(v[k]); });
    return o;
  }
  function kanonik(v, girinti) { return JSON.stringify(sirala(v), null, girinti); }

  /* ---------- Sicil (gunluk) ----------
     Satırların kimliği içeriğidir (satır yazıldıktan sonra değişmez); birleşim küme birleşimidir: iki tarafta da duran
     ya da bir tarafta yeni eklenen satır kalır, son ortak sürümde olup bir tarafta silinen satır düşer. Sıra kanoniktir
     (zaman, sonra içerik) ki iki bilgisayar aynı sicili aynı sırada görsün. Eşitleme kendisi sicil satırı yazmaz. */
  function sicilKimlik(dizi) {
    var say = Object.create(null);
    return dizi.map(function (x) { var k = kanonik(x); var n = say[k] = (say[k] || 0) + 1; return n > 1 ? k + '#' + n : k; });
  }
  function sicilSirala(dizi) {
    var kim = sicilKimlik(dizi);
    var ix = dizi.map(function (x, i) { return { x: x, t: duzNesne(x) && typeof x.t === 'string' ? x.t : '', k: kim[i] }; });
    ix.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0; });
    return ix.map(function (o) { return o.x; });
  }
  function sicilBirlestir(B, L, R) {
    B = Array.isArray(B) ? B : []; L = Array.isArray(L) ? L : []; R = Array.isArray(R) ? R : [];
    var kb = new Set(sicilKimlik(B)), kl = sicilKimlik(L), kr = sicilKimlik(R), sl = new Set(kl), sr = new Set(kr), out = [];
    L.forEach(function (x, i) { if (sr.has(kl[i]) || !kb.has(kl[i])) out.push(x); });
    R.forEach(function (x, i) { if (!sl.has(kr[i]) && !kb.has(kr[i])) out.push(x); });
    return sicilSirala(out);
  }

  /* ---------- Üç yollu birleştirme ---------- */
  // Dizi öğelerinin kimliği: id (depo kayıtları, mesele, vaka), kod (yeni fiş); ötekilerde içeriğin kendisi.
  function kimlikler(dizi) {
    var say = Object.create(null);
    return dizi.map(function (x) {
      var k;
      if (duzNesne(x) && (typeof x.id === 'string' || typeof x.id === 'number')) k = 'i:' + x.id;
      else if (duzNesne(x) && typeof x.kod === 'string') k = 'k:' + x.kod;
      else k = 'j:' + kanonik(x);
      var n = say[k] = (say[k] || 0) + 1;
      return n > 1 ? k + '#' + n : k;
    });
  }
  function harita(dizi, kim) { var m = Object.create(null); kim.forEach(function (k, i) { m[k] = dizi[i]; }); return m; }

  function cakismaYaz(s, yol) {
    for (var i = 0; i < yol.length; i++) if (SAYILMAZ[yol[i]]) return;
    s.cakisma++;
    if (s.yollar.length < 50) s.yollar.push(yol.slice());
  }

  function birlestir(B, L, R, s, yol) {
    if (esit(L, R)) return L;
    if (esit(B, L)) return R;
    if (esit(B, R)) return L;
    if (duzNesne(L) && duzNesne(R)) {
      var b = duzNesne(B) ? B : {}, out = {}, gor = Object.create(null);
      Object.keys(L).concat(Object.keys(R)).forEach(function (k) {
        if (gor[k]) return; gor[k] = 1;
        var v = birlestir(b[k], L[k], R[k], s, yol.concat(k));
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(L) && Array.isArray(R)) return diziBirlestir(Array.isArray(B) ? B : [], L, R, s, yol);
    if (L === undefined) return R;   // bir taraf sildi, öteki değiştirdi: değişiklik korunur
    if (R === undefined) return L;
    var ust = yol[yol.length - 2];
    // sayaç (gunler/oturum sayaçları): iki tarafın artışı toplanır
    if (ust === 'sayac' && typeof L === 'number' && typeof R === 'number') return L + R - (typeof B === 'number' ? B : 0);
    // zaman damgası: ileri olan
    if (typeof L === 'string' && typeof R === 'string' && ISO_RE.test(L) && ISO_RE.test(R)) return L > R ? L : R;
    cakismaYaz(s, yol);
    return L;                        // son eşitleyen geçer
  }

  function diziBirlestir(B, L, R, s, yol) {
    var kb = kimlikler(B), kl = kimlikler(L), kr = kimlikler(R);
    var mB = harita(B, kb), mL = harita(L, kl);
    var bas = [], orta = [], son = [], ortakGoruldu = false, mR = harita(R, kr);
    R.forEach(function (x, i) {
      var k = kr[i];
      if (k in mL) orta.push(birlestir(mB[k], mL[k], x, s, yol.concat(k.slice(2))));
      else if (k in mB) { if (!esit(mB[k], x)) orta.push(x); }   // burada silindi; depoda değiştiyse kalır
      else orta.push(x);                                          // depoda eklendi
    });
    L.forEach(function (x, i) {
      var k = kl[i];
      if (k in mR) { ortakGoruldu = true; return; }
      if (k in mB) { if (!esit(mB[k], x)) (ortakGoruldu ? son : bas).push(x); return; }  // depoda silindi; burada değiştiyse kalır
      (ortakGoruldu ? son : bas).push(x);                         // burada eklendi (başa eklenen başta kalır)
    });
    return bas.concat(orta, son);
  }

  /* Durum düzeyinde: anahtar anahtar; 'gunluk' küme birleşimi. → {deger, cakisma, yollar} */
  function durumBirlestir(B, L, R) {
    B = B || {}; L = L || {}; R = R || {};
    var s = { cakisma: 0, yollar: [] }, out = {}, gor = Object.create(null);
    Object.keys(L).concat(Object.keys(R)).forEach(function (k) {
      if (gor[k]) return; gor[k] = 1;
      var v = k === 'gunluk' ? sicilBirlestir(B[k], L[k], R[k]) : birlestir(B[k], L[k], R[k], s, [k]);
      if (!bosMu(v)) out[k] = v;
    });
    return { deger: out, cakisma: s.cakisma, yollar: s.yollar };
  }

  /* Ham kayıt → durum: yalnız paylaşılan anahtarlar, boşlar atılır, gunlukArsiv + gunluk tek sicil. paylasilir:
     isteğe bağlı süzgeç (Rahle kendi App.veri.arastirmaKaydiMi'sini verir; yoksa yukarıdaki iki desen). */
  function durumYap(kayitlar, paylasilir) {
    var d = {}, sicil = [], suz = paylasilir || paylasilirMi;
    Object.keys(kayitlar || {}).forEach(function (k) {
      if (!suz(k)) return;
      var v = kayitlar[k];
      if (k === 'gunluk' || k === 'gunlukArsiv') { if (Array.isArray(v)) sicil = sicil.concat(v.filter(duzNesne)); return; }
      if (!bosMu(v)) d[k] = v;
    });
    if (sicil.length) d.gunluk = sicilSirala(sicil);
    return d;
  }
  /* Durum → yerelde yazılacak anahtarlar: {anahtar: değer | null (sil)}. Sicil etkin (son satırlar) + arşiv diye bölünür
     (çekirdeğin tavanı: etkin ≤ 2 000; taşınca 1 500 kalır). eski: şimdiki ham kayıt (yalnız değişenler döner). */
  var SICIL_TAVAN = 2000, SICIL_KALAN = 1500;
  function yazilacaklar(durum, eskiDurum) {
    var out = {};
    var tum = Object.keys(durum || {}).concat(Object.keys(eskiDurum || {}));
    var gor = Object.create(null);
    tum.forEach(function (k) {
      if (gor[k]) return; gor[k] = 1;
      if (k === 'gunluk') return;
      if (!esit(durum[k], eskiDurum[k])) out[k] = durum[k] === undefined ? null : durum[k];
    });
    if (!esit(durum.gunluk || [], eskiDurum.gunluk || [])) {
      var g = durum.gunluk || [], n = g.length > SICIL_TAVAN ? g.length - SICIL_KALAN : 0;
      out.gunluk = g.length ? g.slice(n) : null;
      out.gunlukArsiv = n ? g.slice(0, n) : null;
    }
    return out;
  }

  /* ---------- Dosya düzeni ---------- */
  // FNV-1a (32 bit) + son karıştırma: kod/kimlik → kova numarası (kararlı; iki bilgisayarda aynı)
  function ozet(t) {
    var h = 0x811c9dc5; t = String(t);
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return h >>> 0;
  }
  function iki(n) { return (n < 10 ? '0' : '') + n; }
  function yolAd(k) { return encodeURIComponent(k); }
  function dizimi(v) {
    if (!Array.isArray(v) || !v.length) return false;
    var gor = Object.create(null);
    for (var i = 0; i < v.length; i++) {
      var x = v[i];
      if (!duzNesne(x) || typeof x.id !== 'string' || gor[x.id]) return false;
      gor[x.id] = 1;
    }
    return true;
  }
  function satirliNesne(o) {
    var ks = Object.keys(o).sort();
    return '{\n' + ks.map(function (k) { return JSON.stringify(k) + ': ' + kanonik(o[k]); }).join(',\n') + '\n}\n';
  }
  function satirliDizi(a) { return a.length ? '[\n' + a.map(function (x) { return kanonik(x); }).join(',\n') + '\n]\n' : '[]\n'; }

  // Durum → depo dosyaları {yol: metin}
  function ayir(d) {
    var dosyalar = {}, genel = {};
    dosyalar[KLASOR + 'sema.json'] = kanonik({ sema: SEMA, aciklama: 'Rahle ortak kaydı — araclar/yayin/ortak.js ile yazılır; elle düzenlemeyin.' }, 1) + '\n';
    Object.keys(d).sort().forEach(function (k) {
      var v = d[k];
      if (bosMu(v)) return;
      if (k === 'gunluk' && Array.isArray(v)) {
        // satırlar zaman sırasında eklendiğinden yeni satırlar hep son bloğa düşer
        var g = sicilSirala(v);
        for (var i = 0; i * SICIL_BLOK < g.length; i++) dosyalar[KLASOR + 'sicil/' + ('000' + i).slice(-4) + '.json'] = satirliDizi(g.slice(i * SICIL_BLOK, (i + 1) * SICIL_BLOK));
        return;
      }
      if (KOVALI[k] && duzNesne(v)) {
        var kv = {};
        Object.keys(v).forEach(function (a) { var n = ozet(a) % KOVALI[k]; (kv[n] = kv[n] || {})[a] = v[a]; });
        Object.keys(kv).forEach(function (n) { dosyalar[KLASOR + 'kova/' + yolAd(k) + '/' + iki(+n) + '.json'] = satirliNesne(kv[n]); });
        return;
      }
      var metin = kanonik(v);
      if (metin.length > ESIK && dizimi(v)) {
        var kd = {};
        v.forEach(function (x) { var n = ozet(x.id) % DIZI_KOVA; (kd[n] = kd[n] || []).push(x); });
        Object.keys(kd).forEach(function (n) {
          kd[n].sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
          dosyalar[KLASOR + 'dizi/' + yolAd(k) + '/' + iki(+n) + '.json'] = satirliDizi(kd[n]);
        });
        dosyalar[KLASOR + 'dizi/' + yolAd(k) + '/sira.json'] = satirliDizi(v.map(function (x) { return x.id; }));
        return;
      }
      if (metin.length > ESIK) dosyalar[KLASOR + 'anahtar/' + yolAd(k) + '.json'] = kanonik(v, 1) + '\n';
      else genel[k] = v;
    });
    dosyalar[KLASOR + 'genel.json'] = satirliNesne(genel);
    return dosyalar;
  }

  // Depo dosyaları → durum
  function topla(dosyalar) {
    var d = {}, sicil = [], diziler = {};
    var metinOf = function (yol) { var x = dosyalar[yol]; return typeof x === 'string' ? x : x.metin; };
    Object.keys(dosyalar).sort().forEach(function (yol) {
      if (yol.indexOf(KLASOR) !== 0) return;
      var ic = yol.slice(KLASOR.length), m;
      if (ic === 'genel.json') { var g = JSON.parse(metinOf(yol)); Object.keys(g).forEach(function (k) { d[k] = g[k]; }); }
      else if ((m = ic.match(/^anahtar\/(.+)\.json$/))) d[decodeURIComponent(m[1])] = JSON.parse(metinOf(yol));
      else if ((m = ic.match(/^kova\/(.+)\/\d+\.json$/))) { var k = decodeURIComponent(m[1]), o = JSON.parse(metinOf(yol)); d[k] = d[k] || {}; Object.keys(o).forEach(function (a) { d[k][a] = o[a]; }); }
      else if ((m = ic.match(/^dizi\/(.+)\/(sira|\d+)\.json$/))) { var dk = decodeURIComponent(m[1]); var z = diziler[dk] = diziler[dk] || { sira: null, ogeler: [] }; var a = JSON.parse(metinOf(yol)); if (m[2] === 'sira') z.sira = a; else z.ogeler = z.ogeler.concat(a); }
      else if ((m = ic.match(/^sicil\/.+\.json$/))) sicil = sicil.concat(JSON.parse(metinOf(yol)));
    });
    Object.keys(diziler).forEach(function (k) {
      var z = diziler[k], ix = Object.create(null), out = [];
      z.ogeler.forEach(function (x) { ix[x.id] = x; });
      (z.sira || []).forEach(function (id) { if (ix[id]) { out.push(ix[id]); delete ix[id]; } });
      z.ogeler.forEach(function (x) { if (ix[x.id]) { out.push(x); delete ix[x.id]; } });
      d[k] = out;
    });
    if (sicil.length) d.gunluk = sicilSirala(sicil);
    return d;
  }

  /* ---------- GitHub istemcisi (Git Data API) ---------- */
  function b64Metin(b64) {
    var ikili = atob(String(b64).replace(/\s+/g, '')), u = new Uint8Array(ikili.length);
    for (var i = 0; i < ikili.length; i++) u[i] = ikili.charCodeAt(i);
    return new TextDecoder().decode(u);
  }

  function Depo(o) {
    this.token = o.token; this.sahip = o.sahip; this.ad = o.ad; this.dal = o.dal || 'ortak-kayit';
    this.fetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(kok) : null);
  }
  Depo.prototype.istek = function (yontem, yol, govde) {
    var self = this;
    return Promise.resolve().then(function () {
      return self.fetch('https://api.github.com/repos/' + self.sahip + '/' + self.ad + yol, {
        method: yontem, cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: govde ? JSON.stringify(govde) : undefined
      });
    }).then(function (r) {
      return r.text().then(function (t) {
        var v = null; try { v = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.ok) return v;
        var h = new Error('GitHub ' + r.status + (v && v.message ? ': ' + v.message : ''));
        h.durum = r.status; throw h;
      });
    }, function (e) {
      var h = new Error('Ağ hatası: ' + (e && e.message || e)); h.ag = true; throw h;
    });
  };
  // Dalın son hâli {commit, agac, dosyalar: {yol: {sha, metin}}} ya da dal yoksa null. Değişmemişse önbellek döner;
  // dosyalar yalnız değiştiyse indirilir.
  Depo.prototype.oku = function (onbellek) {
    var self = this;
    return self.istek('GET', '/git/ref/heads/' + encodeURIComponent(self.dal)).then(function (ref) {
      var commit = ref.object.sha;
      if (onbellek && onbellek.commit === commit) return onbellek;
      return self.istek('GET', '/git/commits/' + commit).then(function (c) {
        return self.istek('GET', '/git/trees/' + c.tree.sha + '?recursive=1').then(function (agac) {
          var eski = (onbellek && onbellek.dosyalar) || {}, dosyalar = {};
          var isler = agac.tree.filter(function (e) { return e.type === 'blob' && e.path.indexOf(KLASOR) === 0; }).map(function (e) {
            if (eski[e.path] && eski[e.path].sha === e.sha) { dosyalar[e.path] = eski[e.path]; return null; }
            return self.istek('GET', '/git/blobs/' + e.sha).then(function (b) { dosyalar[e.path] = { sha: e.sha, metin: b64Metin(b.content) }; });
          });
          return Promise.all(isler).then(function () { return { commit: commit, agac: c.tree.sha, dosyalar: dosyalar }; });
        });
      });
    }, function (e) { if (e.durum === 404) return null; throw e; });
  };
  // Yeni commit; dal başka biri tarafından ilerletildiyse hata.cakisma = true (yarış: yeniden okunup birleştirilir).
  Depo.prototype.yaz = function (eski, yeni, mesaj) {
    var self = this, girdiler = [], dosyalar = {};
    var onceki = (eski && eski.dosyalar) || {};
    var isler = Object.keys(yeni).map(function (yol) {
      if (onceki[yol] && onceki[yol].metin === yeni[yol]) { dosyalar[yol] = onceki[yol]; return null; }
      return self.istek('POST', '/git/blobs', { content: yeni[yol], encoding: 'utf-8' }).then(function (b) {
        dosyalar[yol] = { sha: b.sha, metin: yeni[yol] };
        girdiler.push({ path: yol, mode: '100644', type: 'blob', sha: b.sha });
      });
    });
    Object.keys(onceki).forEach(function (yol) { if (!(yol in yeni)) girdiler.push({ path: yol, mode: '100644', type: 'blob', sha: null }); });
    return Promise.all(isler).then(function () {
      if (eski && !girdiler.length) return eski;
      girdiler.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
      var agacGovde = { tree: girdiler };
      if (eski) agacGovde.base_tree = eski.agac;
      return self.istek('POST', '/git/trees', agacGovde).then(function (agac) {
        return self.istek('POST', '/git/commits', { message: mesaj, tree: agac.sha, parents: eski ? [eski.commit] : [] }).then(function (c) {
          var ilerlet = eski
            ? self.istek('PATCH', '/git/refs/heads/' + encodeURIComponent(self.dal), { sha: c.sha, force: false })
            : self.istek('POST', '/git/refs', { ref: 'refs/heads/' + self.dal, sha: c.sha });
          return ilerlet.then(function () { return { commit: c.sha, agac: agac.sha, dosyalar: dosyalar }; }, function (e) {
            if (e.durum === 422 || e.durum === 409) e.cakisma = true;
            throw e;
          });
        });
      });
    });
  };

  /* ---------- Eşitleme turu ----------
     o.depo · o.taban (son eşitlenen okuma {commit, agac, dosyalar} ya da null: bu tarayıcı hiç eşitlemedi) ·
     o.yerel (bu tarayıcının durumu; durumYap ile) · o.kullanici · o.izin(yerelDegisecek) → false dönerse depoya yazmadan
     durur (kullanıcı yazıyor) · o.deneme (yarışta yeniden deneme, öntanımlı 3).
     Sonuç: {durum, okuma, yerelDegisti, gonderildi, cakisma, yollar, ilk (dal yoktu, bu tarayıcı başlangıç oldu),
     ilkBaglanis (dal vardı, depodaki esas alındı)} ya da {ertelendi: true}. */
  function esitle(o) {
    var izin = o.izin || function () { return true; };
    var deneme = o.deneme == null ? 3 : o.deneme;
    var yerel = o.yerel || {};
    var degisenAd = function (a, b) {
      var l = []; Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (l.indexOf(k) < 0 && !esit(a[k], b[k])) l.push(k); });
      return l;
    };
    var mesaj = function (ek, adlar) {
      return 'Ortak kayıt: ' + (o.kullanici || 'bilinmeyen') + (ek ? ' · ' + ek : '') +
        (adlar && adlar.length ? '\n\n' + adlar.slice(0, 12).join(', ') + (adlar.length > 12 ? ' …' : '') : '');
    };
    var tur = function () {
      return o.depo.oku(o.taban).then(function (uzak) {
        if (!uzak) {
          // Dal yok: bu tarayıcının kaydı ortak kaydın başlangıcı olur.
          if (!izin(false)) return { ertelendi: true };
          return o.depo.yaz(null, ayir(yerel), mesaj('başlangıç', Object.keys(yerel).sort())).then(function (yeni) {
            return { durum: yerel, okuma: yeni, yerelDegisti: false, gonderildi: true, cakisma: 0, yollar: [], ilk: true };
          });
        }
        var uzakDurum = topla(uzak.dosyalar);
        if (!o.taban) {
          // Bu tarayıcı ilk kez bağlanıyor: depodaki kayıt esas alınır (önceki yerel kayıt çağıran tarafından saklanır).
          var degisir = !esit(yerel, uzakDurum);
          if (!izin(degisir)) return { ertelendi: true };
          return { durum: uzakDurum, okuma: uzak, yerelDegisti: degisir, gonderildi: false, cakisma: 0, yollar: [], ilkBaglanis: true };
        }
        // dal ilerlemediyse (çoğu 30 s'lik tur) taban = depo: birleşim bu tarayıcının kaydıdır
        var b = uzak === o.taban || uzak.commit === o.taban.commit ? { deger: yerel, cakisma: 0, yollar: [] } : durumBirlestir(topla(o.taban.dosyalar), yerel, uzakDurum);
        var birlesik = b.deger;
        var yerelDegisti = !esit(birlesik, yerel), gonder = !esit(birlesik, uzakDurum);
        if (!izin(yerelDegisti)) return { ertelendi: true };
        var yaz = gonder ? o.depo.yaz(uzak, ayir(birlesik), mesaj(b.cakisma ? b.cakisma + ' çakışma' : '', degisenAd(birlesik, uzakDurum))) : Promise.resolve(uzak);
        return yaz.then(function (yeni) {
          return { durum: birlesik, okuma: yeni, yerelDegisti: yerelDegisti, gonderildi: gonder, cakisma: b.cakisma, yollar: b.yollar };
        });
      }).catch(function (e) {
        if (e && e.cakisma && deneme-- > 0) return tur();   // dal bu arada ilerledi: yeniden oku, yeniden birleştir
        throw e;
      });
    };
    return tur();
  }

  var api = {
    SEMA: SEMA, KLASOR: KLASOR, paylasilirMi: paylasilirMi, esit: esit, kanonik: kanonik,
    birlestir: function (B, L, R) { var s = { cakisma: 0, yollar: [] }; var v = birlestir(B, L, R, s, []); return { deger: v, cakisma: s.cakisma, yollar: s.yollar }; },
    durumBirlestir: durumBirlestir, sicilBirlestir: sicilBirlestir, durumYap: durumYap, yazilacaklar: yazilacaklar,
    ayir: ayir, topla: topla, Depo: Depo, esitle: esitle
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else kok.RahleOrtak = api;
})(typeof window !== 'undefined' ? window : globalThis);
