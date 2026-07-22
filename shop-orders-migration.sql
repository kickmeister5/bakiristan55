-- shop_purchases tablosu daha önce oluşturulduysa bu dosyayı D1 Console'da bir kez çalıştırın.
ALTER TABLE shop_purchases ADD COLUMN shipping_address TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_purchases ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_purchases ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
