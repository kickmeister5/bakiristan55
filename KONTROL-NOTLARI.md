# Doğrulama notları

## Otomatik kontroller

`npm test`: 5 test başarılı. HTTP testi içinde iki ayrı oyuncu, admin/yayıncı ayrımı, hatalı giriş, dosya türü doğrulama, fotoğraf yükleme, araç kaydetme, filtre için yetersiz havuz, oda kilidi, gizli fiyat, başka oyuncunun tahmininin gizlenmesi, oda verisinin sabit kalması, tekrar sonuç açmanın reddi, final sıralaması, sunucu yeniden başlatma ve süre sonrası tahmin reddi kontrol edildi.

## Tarayıcı kontrolleri

- İki ayrı sekmede yayıncı ve arkadaş katılımı; oda kodu ile aynı odaya erişim.
- Tahmin gönderme, sonuçların iki oyuncuya açılması, sonraki tur ve final ekranı.
- Admin girişi, marka/model araması, araç düzenleme.
- Gerçek dosya seçiciyle fotoğraf yükleme, fotoğraf sırası değiştirme, kaporta kaydı değiştirme ve kaydetme.
- Oyuncu önizlemesinde gizli fiyat ve admin notunun bulunmaması.
- 1440 piksel masaüstü ve 390 piksel mobil görünüm. Mobil editörde taşan kaporta seçimleri düzeltildi; son kontrolde ekran dışına taşan giriş alanı bulunmadı.
- İncelenen mobil oyun sayfasında tarayıcı hata kaydı bulunmadı.

## Kapsam

İlk tahmin kilidi: HTTP testinde aynı oyuncunun hem farklı tutarla hem aynı tutarla ikinci gönderimi 409 ile reddedildi; ilk değer korundu. Tarayıcıda beş kişilik örnek odada üç gönderim sonrası 3/5 sayacı ve kilitli tahmin doğrulandı. Sayfa yenilemesinden sonra tahmin giriş alanı geri gelmedi ve kayıtlı tutar değişmedi. Beş otomatik test başarılı.

Ekrana sığdır güncellemesi: 614×672 ve 1366×768 pencerelerde ana ekran ve oyun için belge boyutunun pencere sınırlarını aşmadığı, ölçeklenen içerik ve tahmin düğmesinin görünür kaldığı kontrol edildi. Normal boyuta geçiş ve yeniden otomatik ölçekleme doğrulandı. İş mantığında değişiklik yapılmadı.

Kontroller yerel sunucuda yapıldı. Farklı fiziksel cihazlar, internet üzerinden dağıtım, yüksek yük ve tüm tarayıcı kombinasyonları test edilmedi. HTML tasarım önizlemeleri, çalışan uygulamadan alınan örnek ekranların salt okunur kopyalarıdır; canlı oyun işlevi taşımaz. Önizlemelerde yalnızca temsili araç ve oyuncu verileri vardır. Test kullanıcıları ve parolaları dağıtılan ZIP'e dahil değildir.
