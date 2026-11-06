/* =========================================================
   Rahle — ortak kayıt kitaplığı (bilgisayarlar arası eşitleme; eski sitenin tools/yayin/ortak.js düzeni).

   Araştırma kaydı (Rahle'nin veri.* depo.* gunluk/gunlukArsiv + sarih.yorum/taslak, mesele.vakalar, kuyruk.ozel,
   tez.taslak.*, oku.mobilTaslak anahtarları) özel depodaki ayrı bir dalda (öntanımlı Ramazan9838/Rahle › ortak-kayit)
   JSON dosyaları olarak durur; GitHub Git Data API ile okunur ve yazılır, ana dala dokunulmaz. Birleştirme üç yolludur
   (son ortak sürüm / bu tarayıcı / depo): farklı fişlerde ve alanlarda yapılan değişiklikler birbirini ezmez; aynı alanı
   iki taraf farklı değiştirdiyse son eşitleyen (bu tarayıcı) geçer ve çakışma sayılır.
   73.2 (6 Kas 2026): silinen kimlikli dizi öğesi ortak kayıtta mezar taşı {id|kod, silindi:true, t} olarak kalır (yerel
   kayda yazılmaz); kayıtların ya da anahtarların %20'sinden fazlası silinecekse o.silmeOnay sorulur, onaysız silme
   gönderilmez; yalnız eklenen depolarda silme yok sayılır; aynı kimlikli iki yeni kayıtta bu tarayıcınınki yeniden
   kimliklendirilir (kimlikSicili 'yeniden-kimlik'); kimliksiz dizi öğesinin düzeltmesi sıradaki öğeyle eşleşir.

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
  var ARASTIRMA_EK_RE = /^(sarih\.(yorum|taslak)$|mesele\.vakalar$|kuyruk\.ozel$|tez\.taslak\.|oku\.mobilTaslak$|analiz\.donemAtama$)/;
  /* Çakışma sayılmayan yollar: türetilmiş alanlar (fisIndeksle yeniden hesaplar), iz damgaları, günlük sayım özeti.
     Aynı yerde iki taraf farklı yazdıysa yine bu tarayıcının değeri geçer, yalnız sayıya eklenmez. */
  var SAYILMAZ = { iz: 1, esik: 1, karineSayisi: 1, kuyrukSayim: 1 };
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  /* Yalnız eklenen depolar (O-10, DO-02): karar/onay/sicil kayıtları birleşimde silinmez (iki yönde de silme yok sayılır);
     geri alma bu depolarda yeni kayıtla yapılır. depo.yapilacaklar'da yalnız kontrol programı olayları (program alanı). */
  var YALNIZ_EKLENIR = /^depo\.(oneriKararlari|kimlikSicili|mukerrerKararlari|kaynakKararlari|erisimTakip|arastirmaBaglari|tohumSilinen)$/;
  function yalnizEklenir(k, x) { return YALNIZ_EKLENIR.test(k) || (k === 'depo.yapilacaklar' && duzNesne(x) && typeof x.program === 'string'); }
  /* Mezar taşı (O-6): ortak kayıtta silinen kimlikli dizi öğesi {id|kod, silindi:true, t} olarak kalır; öbür bilgisayarın
     eski tabanı ya da düzeltmesi onu diriltmez. Yerel kayda (Rahle'nin depolarına) mezar yazılmaz: esitle onları ayıklar. */
  function mezarMi(x) { return duzNesne(x) && x.silindi === true && Object.keys(x).every(function (k) { return k === 'id' || k === 'kod' || k === 'silindi' || k === 't'; }); }
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

  /* Çakışma: yol ve (s.ayrinti varsa) iki tarafın değeri saklanır; Rahle bunları "Çakışmaları incele" penceresinde
     gösterir ve araştırmacı öbür bilgisayarın değerini sonradan alabilir (birleşimde bu tarayıcınınki geçer). */
  function cakismaYaz(s, yol, B, L, R) {
    for (var i = 0; i < yol.length; i++) if (SAYILMAZ[yol[i]]) return;
    s.cakisma++;
    if (s.yollar.length < 50) s.yollar.push(yol.slice());
    if (s.ayrinti && s.ayrinti.length < 200) s.ayrinti.push({ yol: yol.slice(), taban: B === undefined ? null : B, yerel: L, uzak: R });
  }

  function birlestir(B, L, R, s, yol) {
    if (esit(L, R)) return L;
    if (esit(B, L)) return R;
    if (esit(B, R)) return L;
    if (mezarMi(L) || mezarMi(R)) {
      // bir taraf sildi: öbürü tabandan değişmediyse ya da taban da mezarsa silme geçer; taban yoksa (iki tarafta yeni) canlı kalır
      var canli = mezarMi(L) ? R : L;
      if (B === undefined || mezarMi(B) || mezarMi(canli)) return canli === undefined ? (mezarMi(L) ? L : R) : canli;
      var olu = mezarMi(L) ? L : R;
      // silinen kayıt öbür tarafta düzeltilmişti: silme geçer; incelemede "geçerli" = silme, "öbürü" = düzeltilmiş kayıt
      if (!esit(B, canli)) cakismaYaz(s, yol, B, olu, canli);
      return olu;
    }
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
    cakismaYaz(s, yol, B, L, R);
    return L;                        // son eşitleyen geçer
  }

  /* Kimliksiz nesne öğesi (ek.notlar, gecmis…; Y-9): tabandaki öğenin yerinde duran yeni içerik o öğenin düzeltmesi sayılır
     (aynı sırada, taban öğesi bu tarafta yok) → iki tarafın düzeltmesi tek öğede birleşir, aynı alan çakışma sayılır. */
  function sirayaBagla(B, kb, X, kx) {
    var sb = new Set(kb), sx = new Set(kx);
    for (var i = 0; i < Math.min(B.length, X.length); i++)
      if (kx[i][0] === 'j' && kb[i][0] === 'j' && !sb.has(kx[i]) && !sx.has(kb[i]) && duzNesne(X[i]) && duzNesne(B[i])) kx[i] = kb[i];
    return kx;
  }
  function diziBirlestir(B, L, R, s, yol) {
    var kb = kimlikler(B), kl = sirayaBagla(B, kb, L, kimlikler(L)), kr = sirayaBagla(B, kb, R, kimlikler(R));
    var ek = yol.length === 1 ? yol[0] : null;
    var mB = harita(B, kb), mL = harita(L, kl);
    var bas = [], orta = [], son = [], ortakGoruldu = false, mR = harita(R, kr);
    R.forEach(function (x, i) {
      var k = kr[i];
      if (k in mL) orta.push(birlestir(mB[k], mL[k], x, s, yol.concat(k.slice(2))));
      else if (k in mB) { if (!esit(mB[k], x) || (ek && yalnizEklenir(ek, x))) orta.push(x); }   // burada silindi; depoda değiştiyse (ya da yalnız eklenen depodaysa) kalır
      else orta.push(x);                                          // depoda eklendi
    });
    L.forEach(function (x, i) {
      var k = kl[i];
      if (k in mR) { ortakGoruldu = true; return; }
      if (k in mB) { if (!esit(mB[k], x) || (ek && yalnizEklenir(ek, x))) (ortakGoruldu ? son : bas).push(x); return; }  // depoda silindi; burada değiştiyse kalır
      (ortakGoruldu ? son : bas).push(x);                         // burada eklendi (başa eklenen başta kalır)
    });
    return bas.concat(orta, son);
  }

  /* Durum düzeyinde: anahtar anahtar; 'gunluk' küme birleşimi. → {deger, cakisma, yollar} */
  function durumBirlestir(B, L, R) {
    B = B || {}; L = L || {}; R = R || {};
    var s = { cakisma: 0, yollar: [], ayrinti: [] }, out = {}, gor = Object.create(null);
    Object.keys(L).concat(Object.keys(R)).forEach(function (k) {
      if (gor[k]) return; gor[k] = 1;
      var dz = function (x) { return Array.isArray(x) ? x : []; };
      var v = k === 'gunluk' ? sicilBirlestir(B[k], L[k], R[k])
        : (YALNIZ_EKLENIR.test(k) || k === 'depo.yapilacaklar') && Array.isArray(L[k] || R[k]) ? diziBirlestir(dz(B[k]), dz(L[k]), dz(R[k]), s, [k])
        : birlestir(B[k], L[k], R[k], s, [k]);
      if (!bosMu(v)) out[k] = v;
    });
    return { deger: out, cakisma: s.cakisma, yollar: s.yollar, ayrinti: s.ayrinti };
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
    }, function (e) {
      if (e.durum !== 404) throw e;
      // Özel depoda GitHub yetki sorununu da 404 ile bildirir: "dal yok" demeden önce depo görünüyor mu bakılır.
      // Görünmüyorsa bu tarayıcının kaydıyla yeni dal kurulmaya çalışılmaz; anahtar geçersiz sayılır.
      return self.istek('GET', '').then(function () { return null; }, function (e2) {
        if (e2.durum === 404) { var h = new Error('GitHub 404: depo bu erişim anahtarıyla görünmüyor (anahtarın depo izni ya da süresi)'); h.durum = 401; h.depoGorunmuyor = true; throw h; }
        throw e2;
      });
    });
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

  /* ---------- Silme modeli (K-1, O-6) ve kimlik çakışması (K-2) ---------- */
  function kimlikAl(x) { return !duzNesne(x) ? null : (typeof x.id === 'string' || typeof x.id === 'number') ? 'i:' + x.id : typeof x.kod === 'string' ? 'k:' + x.kod : null; }
  // yerel + mezarlar: tabandaki mezar taşınır; tabanda olup yerelde olmayan kimlikli öğe mezar olur (yalnız eklenenler hariç)
  function mezarEkle(T, yerel, t) {
    var out = Object.assign({}, yerel);
    Object.keys(T).forEach(function (k) {
      var tv = T[k], lv = yerel[k]; if (k === 'gunluk' || !Array.isArray(tv) || (lv !== undefined && !Array.isArray(lv))) return;
      lv = lv || []; var var_ = Object.create(null), ek = [];
      lv.forEach(function (x) { var i = kimlikAl(x); if (i) var_[i] = 1; });
      tv.forEach(function (x) {
        var i = kimlikAl(x); if (!i || var_[i]) return;
        if (mezarMi(x)) ek.push(x); else if (!yalnizEklenir(k, x)) ek.push(x.id != null ? { id: x.id, silindi: true, t: t } : { kod: x.kod, silindi: true, t: t });
      });
      if (ek.length) out[k] = lv.concat(ek);
    });
    return out;
  }
  function mezarImza(d) { var l = []; Object.keys(d).forEach(function (k) { if (Array.isArray(d[k]) && k !== 'gunluk') d[k].forEach(function (x) { if (mezarMi(x)) l.push(k + '|' + kimlikAl(x) + '|' + x.t); }); }); return l.sort().join('\n'); }
  function canliYap(d) {
    var out = {};
    Object.keys(d).forEach(function (k) { var v = d[k]; if (Array.isArray(v) && k !== 'gunluk') { v = v.filter(function (x) { return !mezarMi(x); }); if (v.length) out[k] = v; } else out[k] = v; });
    return out;
  }
  // U (depo) → M (gönderilecek): silinen kayıt (dizi öğesi, nesne anahtarı, sicil satırı) ve anahtar sayısı
  function silmeOlc(U, M) {
    var r = { kayit: 0, toplam: 0, anahtar: 0, anahtarToplam: 0, ornek: [] };
    Object.keys(U).forEach(function (k) {
      var u = U[k], m = M[k], n = 0, sil = 0;
      if (Array.isArray(u)) {
        var kim = k === 'gunluk' ? sicilKimlik : kimlikler, ku = kim(u), mm = Object.create(null);
        if (Array.isArray(m)) kim(m).forEach(function (x, i) { if (!mezarMi(m[i])) mm[x] = 1; });
        u.forEach(function (x, i) { if (mezarMi(x)) return; n++; if (!mm[ku[i]]) sil++; });
      } else if (duzNesne(u)) { Object.keys(u).forEach(function (a) { n++; if (!duzNesne(m) || !(a in m)) sil++; }); }
      else { n = 1; if (m === undefined) sil = 1; }
      if (!n) return;
      r.toplam += n; r.kayit += sil; r.anahtarToplam++; if (sil === n) r.anahtar++;
      if (sil && r.ornek.length < 12) r.ornek.push(k + ' (' + sil + ')');
    });
    r.toplu = r.kayit > 0 && (r.kayit / r.toplam > TOPLU_SILME || r.anahtar / r.anahtarToplam > TOPLU_SILME);
    return r;
  }
  var TOPLU_SILME = 0.2;
  // onaysız toplu silme: depodaki (U) kayıtlar birleşime geri konur (silme gönderilmez)
  function silmeleriGeriKoy(M, U) {
    var out = Object.assign({}, M);
    Object.keys(U).forEach(function (k) {
      var u = U[k], m = out[k];
      if (m === undefined) out[k] = u;
      else if (k === 'gunluk' && Array.isArray(u) && Array.isArray(m)) out[k] = sicilBirlestir([], m, u);
      else if (Array.isArray(u) && Array.isArray(m)) {
        var yer = Object.create(null), y = m.slice(); kimlikler(m).forEach(function (x, i) { yer[x] = i; });
        kimlikler(u).forEach(function (x, i) { if (mezarMi(u[i])) return; if (!(x in yer)) y.push(u[i]); else if (mezarMi(y[yer[x]])) y[yer[x]] = u[i]; });
        out[k] = y;
      } else if (duzNesne(u) && duzNesne(m)) { var o = Object.assign({}, m); Object.keys(u).forEach(function (a) { if (!(a in o)) o[a] = u[a]; }); out[k] = o; }
    });
    return out;
  }
  /* K-2: sırayla üretilen kimlikler (yeni fiş kodu ve no, M, TM, AD-, KD, AGP-). Aynı kimlik iki tarafta, tabanda yok ve
     içerik farklıysa bu bilgisayarın kaydı sıradaki boş kimliği alır; bu bilgisayarda değişen her yerde (bağlar) taşınır.
     Görünen biçim aynıdır; mevcut (tabandaki) hiçbir kimlik değişmez. AD-901…999 atlanır. */
  var AILELER = ['veri.yeniFisler', 'veri.yeniMeseleler', 'veri.yeniTmler', 'depo.arastirmaDosyalari', 'depo.kararlar', 'depo.gelistirmePlani'];
  function sonrakiKimlik(eski, kul) {
    var m = /^(.*?)(\d+)$/.exec(eski), on = m ? m[1] : eski + '-', gen = m ? m[2].length : 1, enb = 0, atla = function (n) { return on === 'AD-' && n >= 901 && n <= 999; };
    kul.forEach(function (k) { var x = /^(.*?)(\d+)$/.exec(k); if (x && x[1] === on && !atla(+x[2])) enb = Math.max(enb, +x[2]); });
    var n = enb + 1, y;
    do { if (atla(n)) n = 1000; y = on + String(n).padStart(gen, '0'); n++; } while (kul.has(y));
    return y;
  }
  function damga(x, e) { return (duzNesne(x) && (x.olusturma || x.t || x.tarih)) || (e && e.iz && e.iz.olusturma) || ''; }
  function kimlikTasi(L, B, eski, yeni, eskiNo, yeniNo) {
    var NO = { no: 1, fisler: 1, bagliFis: 1, ornekFis: 1 };
    var ced = function (v, ust) {
      if (typeof v === 'string') return v === eski ? yeni : v;
      if (typeof v === 'number') return eskiNo != null && v === eskiNo && NO[ust] ? yeniNo : v;
      if (Array.isArray(v)) return v.map(function (x) { return ced(x, ust); });
      if (duzNesne(v)) { var o = {}; Object.keys(v).forEach(function (a) { o[a === eski ? yeni : a] = ced(v[a], a); }); return o; }
      return v;
    };
    var out = {};
    Object.keys(L).forEach(function (k) {
      var v = L[k], b = B[k];
      if (Array.isArray(v)) {
        var bd = Array.isArray(b) ? b : [], kim = k === 'gunluk' ? sicilKimlik : kimlikler, bm = harita(bd, kim(bd)), kv = kim(v);
        out[k] = v.map(function (x, i) { return kv[i] in bm && esit(bm[kv[i]], x) ? x : ced(x); });
      } else if (duzNesne(v)) {
        var o = {}, bb = duzNesne(b) ? b : {};
        Object.keys(v).forEach(function (a) { var d = !esit(bb[a], v[a]); o[d && a === eski ? yeni : a] = d ? ced(v[a], a) : v[a]; });
        out[k] = o;
      } else out[k] = esit(v, b) ? v : ced(v);
    });
    return out;
  }
  function yenidenKimliklendir(B, L, R, t) {
    var yeniler = [];
    AILELER.forEach(function (k) {
      var alan = k === 'veri.yeniFisler' ? 'kod' : 'id';
      var dz = function (x) { return Array.isArray(x) ? x.filter(function (y) { return duzNesne(y) && !mezarMi(y) && y[alan] != null; }) : []; };
      var b = dz(B[k]), r = dz(R[k]); if (!r.length || !dz(L[k]).length) return;
      var bk = new Set(b.map(function (x) { return String(x[alan]); })), kul = new Set(), noKul = new Set(), rk = Object.create(null), rNo = Object.create(null);
      b.concat(dz(L[k]), r).forEach(function (x) { kul.add(String(x[alan])); if (typeof x.no === 'number') noKul.add(x.no); });
      r.forEach(function (x) { rk[x[alan]] = x; if (!bk.has(String(x[alan])) && typeof x.no === 'number') rNo[x.no] = x; });
      dz(L[k]).forEach(function (x) {
        var id = String(x[alan]); if (bk.has(id)) return;
        var d = rk[id], ekL = L['veri.ek'] && L['veri.ek'][id], ekR = R['veri.ek'] && R['veri.ek'][id];
        var ayni = d && ((damga(x, ekL) && damga(x, ekL) === damga(d, ekR)) || esit(x, d));
        var kodCak = d && !ayni, noCak = alan === 'kod' && typeof x.no === 'number' && rNo[x.no] && rNo[x.no] !== d;
        if (!kodCak && !(noCak && !ayni)) return;
        var yeni = kodCak ? sonrakiKimlik(id, kul) : id, eskiNo = null, yeniNo = null;
        if (alan === 'kod' && typeof x.no === 'number') { eskiNo = x.no; yeniNo = Math.max.apply(null, Array.from(noKul)) + 1; noKul.add(yeniNo); }
        kul.add(yeni);
        L = kimlikTasi(L, B, id === yeni ? null : id, yeni, eskiNo, yeniNo);
        yeniler.push({ anahtar: k, eski: id, yeni: yeni, eskiNo: eskiNo, yeniNo: yeniNo });
      });
    });
    if (yeniler.length) {
      var ks = (Array.isArray(L['depo.kimlikSicili']) ? L['depo.kimlikSicili'] : []).slice();
      yeniler.forEach(function (y) {
        ks.push({ id: 'ortak-' + y.eski + '-' + y.yeni + (y.yeniNo ? '-' + y.yeniNo : ''), tur: 'yeniden-kimlik', eski: [y.eski], yeni: [y.yeni], esleme: [], grup: '', kaynak: 'ortak kayıt', t: t,
          gerekce: 'Ortak kayıt birleşimi: aynı kimlik iki bilgisayarda ayrı kayda verilmiş; bu bilgisayarın kaydı yeni kimlik aldı' + (y.yeniNo ? ' (fiş no ' + y.eskiNo + ' → ' + y.yeniNo + ')' : '') });
      });
      L['depo.kimlikSicili'] = ks;
    }
    return { yerel: L, yeniler: yeniler };
  }

  /* ---------- Eşitleme turu ----------
     o.depo · o.taban (son eşitlenen okuma {commit, agac, dosyalar} ya da null: bu tarayıcı hiç eşitlemedi) ·
     o.yerel (bu tarayıcının durumu; durumYap ile) · o.kullanici · o.izin(yerelDegisecek) → false dönerse depoya yazmadan
     durur (kullanıcı yazıyor) · o.deneme (yarışta yeniden deneme, öntanımlı 3) · o.silmeOnay({kayit, toplam, anahtar,
     anahtarToplam, ornek}) → true | Promise<true>: toplu silmeye (%20'den fazla) izin; yoksa ya da false ise silme gönderilmez.
     Sonuçta ayrıca silme ({kayit, toplam, toplu, gonderildi, ornek} | null) ve yeniKimlikler ([{anahtar, eski, yeni, eskiNo, yeniNo}]).
     Sonuç: {durum, okuma, yerelDegisti, gonderildi, cakisma, yollar, ayrinti ([{yol, taban, yerel, uzak}]), ilk (dal yoktu, bu tarayıcı başlangıç oldu),
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
          // çöp kutusu birleşir (Tohuma dön / kurtarma sonrası ilk bağlanışta silinenlerin kopyası kaybolmasın; K-1 güvencesi)
          var d0 = canliYap(uzakDurum), yc = yerel['depo.copKutusu'], uk = new Set((uzakDurum['depo.copKutusu'] || []).map(function (x) { return x && x.id; }));
          var ekc = Array.isArray(yc) ? yc.filter(function (x) { return duzNesne(x) && !uk.has(x.id); }) : [];
          if (ekc.length) d0['depo.copKutusu'] = (d0['depo.copKutusu'] || []).concat(ekc);
          var degisir = !esit(yerel, d0);
          if (!izin(degisir)) return { ertelendi: true };
          return { durum: d0, okuma: uzak, yerelDegisti: degisir, gonderildi: false, cakisma: 0, yollar: [], ilkBaglanis: true };
        }
        // dal ilerlemediyse (çoğu 30 s'lik tur) taban = depo: birleşim bu tarayıcının kaydıdır (silmeler mezar taşıyla)
        var t = new Date().toISOString(), tabanDurum = topla(o.taban.dosyalar), L = mezarEkle(tabanDurum, yerel, t), yk = { yerel: L, yeniler: [] };
        var ayni = uzak === o.taban || uzak.commit === o.taban.commit;
        if (!ayni) { yk = yenidenKimliklendir(tabanDurum, L, uzakDurum, t); L = yk.yerel; }
        var b = ayni ? { deger: L, cakisma: 0, yollar: [] } : durumBirlestir(tabanDurum, L, uzakDurum);
        var birlesik = b.deger, silme = silmeOlc(uzakDurum, birlesik);
        // toplu silme freni (K-1): kayıtların ya da anahtarların %20'sinden fazlası silinecekse onay; onaysız silme gönderilmez
        var onay = silme.toplu ? Promise.resolve(o.silmeOnay ? o.silmeOnay(silme) : false) : Promise.resolve(true);
        return onay.then(function (evet) {
          if (!evet) birlesik = silmeleriGeriKoy(birlesik, uzakDurum);
          var canli = canliYap(birlesik);
          // mezarların dizideki yeri (yerelde sona eklenir) tek başına gönderim sebebi değildir
          var yerelDegisti = !esit(canli, yerel), gonder = !esit(canli, canliYap(uzakDurum)) || mezarImza(birlesik) !== mezarImza(uzakDurum);
          if (!izin(yerelDegisti)) return { ertelendi: true };
          var yaz = gonder ? o.depo.yaz(uzak, ayir(birlesik), mesaj(b.cakisma ? b.cakisma + ' çakışma' : '', degisenAd(birlesik, uzakDurum))) : Promise.resolve(uzak);
          return yaz.then(function (yeni) {
            return { durum: canli, okuma: yeni, yerelDegisti: yerelDegisti, gonderildi: gonder, cakisma: b.cakisma, yollar: b.yollar, ayrinti: b.ayrinti || [],
              silme: silme.kayit ? { kayit: silme.kayit, toplam: silme.toplam, toplu: silme.toplu, gonderildi: !silme.toplu || !!evet, ornek: silme.ornek } : null, yeniKimlikler: yk.yeniler };
          });
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
    birlestir: function (B, L, R) { var s = { cakisma: 0, yollar: [], ayrinti: [] }; var v = birlestir(B, L, R, s, []); return { deger: v, cakisma: s.cakisma, yollar: s.yollar, ayrinti: s.ayrinti }; },
    durumBirlestir: durumBirlestir, sicilBirlestir: sicilBirlestir, durumYap: durumYap, yazilacaklar: yazilacaklar,
    ayir: ayir, topla: topla, Depo: Depo, esitle: esitle, mezarMi: mezarMi, canliYap: canliYap, silmeOlc: silmeOlc, sonrakiKimlik: sonrakiKimlik
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else kok.RahleOrtak = api;
})(typeof window !== 'undefined' ? window : globalThis);
