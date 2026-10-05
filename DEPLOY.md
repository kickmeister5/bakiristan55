# GitHub + Cloudflare dağıtımı

Bu klasörün içeriğini ayrı GitHub deposunun köküne yükleyin. data/, node_modules/, .wrangler/, .dev.vars ve parola dosyalarını yüklemeyin.

## Cloudflare Workers

1. Node.js 22 veya üzeri ile proje klasöründe npm ci çalıştırın.
2. npx wrangler login ile kendi Cloudflare hesabınıza giriş yapın.
3. npx wrangler r2 bucket create garaj-arena-photos çalıştırın. R2 hesabınızda etkin olmalı. Başka ad seçerseniz wrangler.jsonc dosyasını da güncelleyin.
4. npx wrangler secret put ADMIN_PASSWORD: en az 10 karakterli yönetici parolası belirleyin.
5. npx wrangler secret put HOST_PASSWORD: farklı, en az 8 karakterli yayıncı parolası belirleyin.
6. npm run deploy çalıştırın. İlk API isteği kalıcı veritabanını ve 10 taslak ilanı oluşturur.
7. Cloudflare Workers > garaj-arena > Settings > Domains & Routes bölümünden istediğiniz alt alan adını bağlayın.

GitHub bağlantısı isterseniz Workers & Pages > Create > Import a repository akışında bu depoyu seçin; deploy komutu npm run deploy. R2 bağlantısı ve iki secret yine gereklidir. GitHub Pages olarak yayınlamayın.

## Kullanım

Oyuncu girişi: /. Yönetim: /admin.html. Yönetici parolası ile 10 taslağın eksiklerini tamamlayıp Oyuna hazır durumuna alın. Oda oluşturma ekranında Nick ve yayıncı parolası bulunur; oturum açıldıktan sonra parola tekrar sorulmaz. Oluşturulan oda doğrudan lobiye açılır. Arkadaşlar yalnızca Nick + Oda Kodu ile katılır. Kod yayında maskelidir; yayıncı kopyalar.

## Araç havuzunun durumu

cloudflare/vehicle-drafts.json: Sahibinden AUTO GENÇ mağazasının arama motoru kaydından 10 gerçek ilan referansı. Kaynak yaklaşık 9 ay eski; detay sayfaları araştırma sırasında erişilemedi. Fiyatlar güncel doğrulanmış değildir. Fotoğraf, vites, yakıt, kasa ve kaporta bilgisi uydurulmadı; bu kayıtlar TASLAKTIR. Liste kaynağı: https://autogenc.sahibinden.com/ . İlan detay bağlantıları her kayıtta bulunur. Fotoğraf yükleyip bilgileri doğrulayarak aktifleştirin. Eski demo verileri Cloudflare sürümüne aktarılmaz.

## Yerel Cloudflare testi

.dev.vars.example dosyasını .dev.vars olarak kopyalayın ve farklı test parolaları yazın. npm run dev:cloudflare ile yerel Workers/R2/Durable Objects ortamı açılır. Bu dosyayı GitHub'a göndermeyin. npm start eski Node yerel sunucusudur; Cloudflare kodu cloudflare/worker.mjs içindedir.

## Canlı kabul testi

İki ayrı tarayıcıda oda oluşturma/katılma, oda kodunun gizliliği, lobi ayarı eşitleme, aynı aracın görünmesi, ilk tahminin değiştirilememesi, süre bitişi, puanlama, sonraki tur ve sayfa yenilemeyle yeniden bağlanmayı kontrol edin. Oyuncu API yanıtlarında tur bitmeden fiyat olmamalı. Yeniden deploy sonrasında havuzun ve yüklenen fotoğrafların kaldığını doğrulayın.

## İşletim

Bu sürüm küçük arkadaş grubu testleri için tek SQLite Durable Object içinde oda/havuz/oturum tutar; fotoğraflar R2'dedir. Yatay çoklu oda ölçeklemesi hedeflenmemiştir. Odalar 24 saat sonra istek sırasında temizlenir; tur bitişi sunucu zamanıyla her oda isteğinde hesaplanır. Tarayıcı bir saniyede bir günceller. Secret parolaları ilk veritabanı oluşturulurken kullanılır; yayıncı parolasını daha sonra yönetici Ayarlar ekranından değiştirebilirsiniz. Depolama bağının veya migration adının değiştirilmesi yeni veritabanına yol açabilir.
