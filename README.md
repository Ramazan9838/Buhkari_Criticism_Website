# Buhkari_Criticism_Website

Rahle — Buhârî şerh literatüründe tenkit araştırma sisteminin şifreli yayın kopyası.

Adres: https://ramazan9838.github.io/Buhkari_Criticism_Website/

Bu depo yalnız giriş sayfasını (`index.html`), ortak kayıt kitaplığını (`ortak.js`) ve şifreli dosyaları (`kasa.json`, `veri/`) taşır; içerik AES-256-GCM ile şifrelidir ve yalnız şifreyle tarayıcıda açılır. Kaynak paketi (şerhlerin tam metinleri) belge başına ayrı şifreli dosyalardır (`veri/paket.*.bin`); Rahle bir belgeyi yalnız açıldığında indirir ve tarayıcıda saklar. Kaynak kod ve çalışma verileri ayrı, özel bir depodadır. Dosyaları elle düzenlemeyin; yeni sürüm özel depodaki `araclar/yayin/yayinla.py` ile üretilir.
