# RedisChatApp

ASP.NET Core (net9.0) + SignalR + Redis pub/sub ile basit gerçek zamanlı sohbet uygulaması. UI Bootstrap 5 ile hazırlanmıştır.

## Özellikler
- SignalR Hub (ChatHub) ile gerçek zamanlı mesajlaşma
- Redis pub/sub (StackExchange.Redis)
- Bootstrap 5 arayüz (wwwroot/index.html)
- appsettings üzerinden Redis bağlantı ayarı

## Gereksinimler
- .NET SDK 9
- Redis (Docker veya lokal kurulum)

## Hızlı Başlangıç
1) Redis’i başlatın (Docker önerilir)
```cmd
docker run -d --name redis -p 6379:6379 redis:7-alpine
```
Alternatif: WSL/Ubuntu altında redis-server veya Windows için Memurai gibi Redis uyumlu çözümler.

2) Uygulamayı derleyip çalıştırın
```cmd
dotnet restore
dotnet build
dotnet run
```
Varsayılan URL: http://localhost:5020

3) Tarayıcıdan sohbet arayüzünü açın
- http://localhost:5020
- Kullanıcı adı ve mesajı girip “Gönder”e basın. Yeni bir sekme/cihazda aynı sayfayı açıp mesajların anlık geldiğini görebilirsiniz.

## Yapılandırma
Redis bağlantı dizesi `appsettings.json` içinde:
```json
{
  "Redis": {
    "ConnectionString": "localhost:6379,abortConnect=false"
  }
}
```
İsterseniz ortam değişkeni de kullanabilirsiniz:
- `Redis__ConnectionString=localhost:6379,abortConnect=false`

Kestrel portunu değiştirmek isterseniz `appsettings.json`:
```json
{
  "Kestrel": {
    "Endpoints": {
      "Http": { "Url": "http://localhost:5020" }
    }
  }
}
```

## Proje Yapısı
- `Program.cs`: SignalR, Redis bağlantısı, statik dosyalar ve endpoint haritalama
- `Hubs/ChatHub.cs`: Redis publish ve SignalR Hub (subscribe işlemi hosted service’te)
- `wwwroot/index.html`: Bootstrap 5 ile sohbet arayüzü, SignalR JS client
- `appsettings*.json`: Uygulama ve Redis ayarları
- `RedisChatApp.csproj`: .NET Web SDK projesi ve paket referansları

## Çalışma Mantığı (Mimari ve Akış)
Uygulama; istemci (tarayıcı), SignalR Hub, ve Redis arasında pub/sub modeli ile mesajları iletir.

1) İstemci tarafı (wwwroot/index.html)
  - SignalR JS client, `/chat` hub’ına bağlanır ve `ReceiveMessage` event’ini dinler.
  - Kullanıcı bir mesaj gönderdiğinde `connection.invoke('SendMessage', user, message)` çağrılır.

2) Hub (Hubs/ChatHub.cs)
  - `SendMessage(user, message)` içinde Redis’e publish yapılır: `chat_channel` kanalına `user: message` metni gönderilir.
  - Hub, Redis’e abone olmaz; abonelik (Subscribe) uygulama ölçeğinde bir kez yapılır.

3) Arkaplan Servisi (Services/ChatRedisSubscriber.cs)
  - Uygulama açılırken Redis’e tek bir kez `chat_channel` için Subscribe olur.
  - Redis’ten bir mesaj geldiğinde `IHubContext<ChatHub>` kullanarak tüm SignalR istemcilerine `ReceiveMessage` ile yayın yapar.
  - Böylece Hub’ın yaşam döngüsünden bağımsız, güvenli ve ölçeklenebilir bir abonelik sağlanır.

4) Program.cs
  - Redis bağlantısı `appsettings` üzerinden okunur ve `IConnectionMultiplexer` singleon olarak eklenir.
  - SignalR ve statik dosyalar etkinleştirilir.
  - `ChatRedisSubscriber` hosted service olarak kaydedilir.
  - `/chat` endpoint’i `ChatHub` ile eşleştirilir.

Avantajlar
- Hub başına abonelik yerine tek abonelik: daha verimli ve thread-safety sorunlarını önler.
- IHubContext ile yayın: Hub örneğine bağlı kalmadan tüm client’lara mesaj gönderilebilir.
- Redis ile loosely-coupled mimari: Çoklu instance senaryolarında yatay ölçeklemeye uygun.

## Geliştirme
- Hot reload için:
```cmd
dotnet watch run
```
- Log seviyelerini `appsettings.Development.json` üzerinden ayarlayabilirsiniz.

## Sorun Giderme
- Redis bağlantı hataları (ConnectTimeout / SUBSCRIBE timeout)
  - Redis’in gerçekten çalıştığını doğrulayın (Docker konteyneri up olmalı, 6379 portu açık).
  - Güvenlik duvarı/Antivirüs portu engelliyorsa izin verin.
  - Bağlantı dizesine zaman aşımı parametreleri ekleyebilirsiniz:
    - `localhost:6379,abortConnect=false,connectTimeout=5000,syncTimeout=5000`

- Derleme sırasında dosya kilidi (MSB3021 / MSB3027, .exe kilitli)
  - Çalışan uygulamayı kapatın veya süreç sonlandırın:
```cmd
taskkill /F /IM RedisChatApp.exe
```
  - Ardından yeniden derleyip çalıştırın.

- Port çakışması
  - `Kestrel:Endpoints:Http:Url` değerini değiştirin (ör. `http://localhost:5030`).

## Lisans
Bu örnek eğitim amaçlıdır.
