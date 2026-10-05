# Canlı sürüm hazırlığı

GitHub + Cloudflare dağıtımı için **DEPLOY.md** dosyasını izleyin. Ana dağıtım dosyası wrangler.jsonc; Cloudflare uygulaması cloudflare/worker.mjs. Demo varsayılan olarak kapalıdır. Sahibinden kaynaklı 10 kayıt doğrulama bekleyen taslaktır; oynanabilir gerçek araç havuzu henüz tamamlanmamıştır.

Aşağıdaki eski yerel sürüm notlarında geçen örnek oyun yalnızca ENABLE_DEMO=true test ortamı içindir.

# Garaj Arena

Elle hazırlanan araç havuzuyla yayıncı ve arkadaşları için araç fiyatı tahmin oyunu. HTML, CSS ve tarayıcı JavaScript'i; Node.js sunucusu. Harici npm paketi veya derleme gerektirmez.

## Başlatma

1. Node.js 22 veya üzeri kurulu olmalı.
2. Windows'ta `baslat.cmd` dosyasını açın. Alternatif: proje klasöründe `npm start` veya `node server.mjs`.
3. Tarayıcıdan **http://localhost:4173** adresini açın. Sunucu penceresini oyun boyunca açık tutun.
4. “İlk kurulumu tamamla” bağlantısından oyun adını, admin parolasını ve ayrı bir yayıncı parolasını belirleyin. İlk kurulum yalnızca sunucu bilgisayarındaki localhost erişimine açıktır.
5. Araç havuzunda “Araç ekle” ile kendi araçlarınızı girin veya “Örnek araçlar” ile üç deneme kaydı ekleyin.
6. Oyun alanından oda oluşturun. Arkadaşlarınız aynı sunucu adresini açıp oda kodu ve kullanıcı adıyla katılır.

**Hızlı deneme:** Kurulum yapmadan “Örnek oyunu dene” ile üç araçlık bir oda oluşturabilirsiniz. Tek kişiyle de oyun başlatılabilir. Örnek fotoğraflar, fiyatlar ve teknik bilgiler gerçek ilan verisi değildir.

## HTML çıktıları

**Sunucu açmadan tasarımı inceleme:** Proje kökündeki `onizleme.html` dosyasını çift tıklayın. Oyun, admin paneli, araç düzenleme, oda oluşturma, lobi, tur sonucu ve final ekranları arasında geçiş yapabilirsiniz. Bu yedi HTML görünümü kaydedilmiş tasarım örnekleridir; form göndermez veya oyun çalıştırmaz. Aşağıdaki `dist` dosyaları ise çalışan uygulamanın ekranlarıdır.

- `dist/index.html`: ana ekran, oda oluşturma / katılma.
- `dist/admin.html`: admin girişi, araç havuzu, ekleme / düzenleme, kaporta ve fotoğraf yönetimi.
- `dist/oyun.html`: bu tarayıcı sekmesindeki odaya erişim; aktif oda yoksa ana ekrana geçer.
- `dist/style.css` ve `dist/app.js`: ortak tasarım ve uygulama davranışları.

Bu dosyalar çalışan uygulamanın HTML girişleridir. Çift tıklayıp `file://` üzerinden açıldıklarında sunucuyu başlatma yönergesi gösterilir. Hesaplar, ortak araç havuzu, güvenli fiyat saklama ve farklı cihazlardan oyun için Node.js sunucusu çalışmalıdır. Sadece HTML dosyalarını bir statik hosta yüklemek çok oyunculu oyunu çalıştırmaz.

## Aynı ağdaki arkadaşlarla

PowerShell'de proje klasöründe:

```powershell
$env:HOST = '0.0.0.0'
node server.mjs
```

Diğer cihazlar, sunucu bilgisayarının yerel IP adresi ve `4173` portuyla bağlanır (örneğin `http://192.168.1.20:4173`; örnekteki IP'yi kendi bilgisayarınızın IP'siyle değiştirin). İşletim sistemi güvenlik duvarı izin istiyorsa yalnızca güvendiğiniz özel ağ için izin verin. Varsayılan başlatma yalnızca localhost'a açıktır.

**İnternetten farklı şehirlerden katılım:** Bu proje henüz internete yayımlanmadı. Sürekli çalışan Node.js sunucusu, kalıcı disk ve HTTPS sağlayan bir barındırma ortamına kurulmalıdır. İnternetten gelen oda kodu, tek başına localhost'a erişim sağlamaz. Sunucu tek süreç olarak çalışmalıdır; dosya tabanlı depolama çoklu sunucu / çoklu süreç dağıtımına uygun değildir. İlk kurulumu sunucuda yerel erişimle tamamlayın. Üretimde HTTPS reverse proxy, ağ seviyesinde hız sınırı ve yedekleme ekleyin. Bu sürüm küçük arkadaş grubu içindir; yüksek trafik için tasarlanmamıştır.

## Yönetim ve oyun

- Ekranlar varsayılan olarak **Ekrana sığdır** görünümünde açılır. Pencere boyutu, tur değişimi ve içerik değişiminde tüm arayüz otomatik ölçeklenir; sayfayı aşağı/yukarı kaydırmak gerekmez. Üst çubuktan **Normal boyut** ile doğal, kaydırılabilir yerleşime dönülebilir veya **Tam ekran** açılabilir. Küçük pencerelerde tüm içeriğin sığması için yazılar ve kontroller de küçülür. Tercih yalnızca kullanılan tarayıcıda saklanır.

- Admin araçları listeler, arar, filtreler; taslak, aktif veya arşiv durumunda yönetir.
- 8 fotoğrafa kadar JPG / PNG / WebP yüklenebilir. Tarayıcı görüntüleri en fazla 1600 piksel uzun kenara küçültüp JPEG olarak kaydeder. Yüklenen orijinal dosya en fazla 15 MB, sunucuya gönderilen fotoğraf en fazla 3 MB olabilir.
- Fotoğraflar sıraya konabilir; ilk fotoğraf kapaktır. Fotoğraflarda fiyat bulunmamalıdır.
- 13 kaporta parçası için orijinal, boyalı, lokal boyalı, değişen veya bilinmiyor seçilir. Şemaya tıklamak durumu sırayla değiştirir; yanındaki seçim kutuları da kullanılabilir.
- Oyuncu önizlemesinde fiyat, kaynak bağlantısı ve admin notu gösterilmez.
- Admin ve yayıncı rolleri ayrıdır. Yayıncı rolü araç fiyatlarını listeleyemez.
- Oda sahibi tur sayısını (1–30), süreyi (10–180 saniye; arayüzde hazır seçenekler) ve araç filtrelerini belirler. En fazla 16 oyuncu katılır.
- Oda sahibi lobide katılımı kilitleyebilir, arkadaşlarını çıkarabilir ve oyunu başlatabilir.
- Araçlar tekrarsız ve rastgele seçilir. Oda oluşturulurken araç bilgileri/fiyatları o oda için sabitlenir. Sonraki admin düzenlemeleri açık odaları etkilemez.
- Her oyuncu tur başına yalnızca bir tahmin gönderir. İlk gönderim sunucuda kilitlenir; sayfa yenilemek veya isteği tekrar göndermek tahmini değiştirmez. Beklerken gönderim sayısı “6/10 oyuncu tahmin yaptı” biçiminde güncellenir. Herkes gönderirse yayıncı sonucu erken açabilir; aksi durumda süre bitince sonuç açılır.
- Kilitli tahmin kartında yalnızca tutar ve `5/10` biçiminde katılım sayacı görünür. Kartın altındaki bar sunucu süresiyle eşleşerek akıcı biçimde azalır; son 10 saniyede kırmızıya döner. Hareket azaltma tercihi açıksa bar animasyonsuz güncellenir.
- Sunucu saati ve sunucuda hesaplanan puanlar geçerlidir. Diğer oyuncuların tahminleri ve doğru fiyat sonuçtan önce API yanıtlarında bulunmaz.
- Puan: `max(0, round(1000 × (1 − abs(tahmin − fiyat) / fiyat)))`. Gönderilmemiş tahmin 0 puan. Eşit puanlı oyuncular finalde aynı sırayı paylaşır.
- Sonuçtan sonraki tura geçiş oda sahibindedir.
- “Sonuçları aç” ile ayrı bir sonuç sayfasına gidilmez: araç fotoğrafı, özellikleri ve kaporta şeması aynı ekranda kalır. Rakam girişinin yerine ilan fiyatı, oyuncunun kendi tahmini, fiyat farkı ve tur puanı gelir. Sağdaki sıralamada arkadaşların tahminleri ve kazandıkları tur puanları görünür. Sonraki tura geçiş aynı alanın altındadır; final sıralaması son turun ardından ayrıca açılır.
- Sayfa yenilemede oyuncu aynı sekmedeki oturumunu korur. Sekme kapatılır veya sekmenin oturum verisi silinirse oyuncu anahtarının kurtarma akışı yoktur. Devam eden oyuna yeni oyuncu alınmaz.
- Bağlantı kopsa da süre sunucuda ilerler. Oda sahibi bağlantısı kesildiğinde otomatik oda sahibi devri yoktur; aynı sekmeyle geri dönmesi gerekir.
- Odalar 24 saat sonra temizlenir. Araç havuzu ve ayarlar kalıcıdır.
- Admin havuzu hazırladığından fiyatları bilebilir. Yayıncının sürprizi korunacaksa başka bir kişi havuzu hazırlamalıdır.

## Saklama ve güvenlik sınırı

İlk çalıştırmada `data/state.json` ve `data/uploads/` oluşturulur. Ayarlar, parola hash'leri, araçlar, oda durumları ve oturumlar diskte tutulur. Parolalar salt ile scrypt kullanılarak hash'lenir. Giriş anahtarları tarayıcının sekmeye özel sessionStorage alanındadır; 12 saat geçerlidir. Ses tercihi dışında oyun verisi localStorage'a yazılmaz.

Sunucu yalnızca `dist/` içeriğini ve rastgele isimli yüklenen fotoğrafları statik olarak sunar. `samples.json`, `data/`, kaynak kod ve admin fiyatları statik erişime açık değildir. Fotoğraflar gizli veri sayılmaz; hassas bilgi veya fiyat içeren fotoğraf yüklemeyin. Admin uçları sunucuda yetki kontrolü yapar. Yüklenen dosyalar yeniden kullanılabildiği için fotoğraf kaldırma / arşivleme diskteki dosyayı kalıcı silmez; yüksek hacimde kullanım için yetim dosya temizliği eklenebilir.

Yedekleme için sunucuyu durdurup `data/` klasörünü kopyalayın. Parola kurtarma arayüzü bu sürümde yoktur; parolaları güvenli biçimde saklayın. `data/` klasörünü kaynak deposuna veya ZIP dağıtımına dahil etmeyin.

Ortam değişkenleri: `HOST` (varsayılan `127.0.0.1`), `PORT` (varsayılan `4173`), `DATA_DIR` (varsayılan proje içindeki `data`).

## Kontroller

```text
npm test
```

Testler puanlama, tek seferlik sonuç hesaplama, admin/yayıncı ayrımı, iki oyuncu akışı, gizli fiyat, fotoğraf doğrulama, sabit oda verisi, tur sonrası tahmin reddi ve yeniden başlatma sonrası kalıcılığı kontrol eder. Testler geçici veri klasörü kullanır; gerçek havuza dokunmaz.

## Görsel kaynakları

Örnek fotoğraf lisansları ve atıfları `CREDITS.md` dosyasında ve uygulama içindeki “Görsel kaynakları” bölümünde bulunur. Fotoğraflar değiştirilmeden dağıtılmıştır. Verilen fiyat ve teknik detaylar yalnızca oyunun denenmesi için oluşturulmuş temsili verilerdir; güncel piyasa değerlemesi değildir.
