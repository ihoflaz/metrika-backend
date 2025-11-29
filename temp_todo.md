# Metrika Backend TODO Listesi

Bulunan eksiklik ve tutarsizliklar dogrultusunda, oncelikli gelistirme maddeleri asagidaki gibi siralanmistir.

- [x] **Rapor dokumantasyonunu guncelle**  
  `docs/PROJE_DURUM_RAPORU.md` dosyasindaki tamamlanma yuzdeleri ve ozellik listeleri gercek kod durumu ile celisiyordu. Yonetici ozeti ve ilgili bolumler mevcut implementasyonu yansitacak sekilde revize edildi.

- [x] **Kimlik dogrulama akislarini tamamla**  
  Logout ve sifre degistirme uc noktalar eklendi; `AuthService` + `TokenService` artik secret rotasyonu ve refresh token brute-force sinirlamasi destekliyor.

- [x] **Kullanici yonetimi CRUD eksiklerini gider**  
  `/api/v1/users` icin listeleme, detay, olusturma, guncelleme, askiya alma ve yeniden etkinlestirme uc noktalar eklendi; yeni e2e testleriyle dogrulandi.

- [x] **Proje yonetimi tutarsizliklarini kapat**  
  Proje kapanisi artik incelemede bekleyen dokuman surumleri ve BREACHED durumundaki KPI'larla bloklaniyor; `/api/v1/projects/:id/reopen` rotasi ve `tests/projects/project-closure.e2e.test.ts` altindaki yeni senaryolarla dogrulandi.

- [x] **Gorev (Task) modulunu genislet**  
  Tekil gorev goruntuleme ve silme uc noktalar eklendi, yorum duzenleme/silme ve watcher yonetimi tamamlandi, ayrica bagimlilik dongusu kontrolu `TASK_DEPENDENCY_CYCLE` hatasiyla dogrulandi; `tests/tasks/tasks.e2e.test.ts` yeni senaryolari kapsiyor.

- [x] **Audit log kapsamini genislet**  
  Auth disindaki proje/gorev/dokuman islemleri de yeni event kodlariyla `AuditService` uzerinden kaydediliyor; controller katmani olay bazli metadata ve request kimligiyle log basiyor.

- [x] **Klonlama ve depolama tutarliligini koru**  
  `ProjectCloneService` artik `copyDocuments: true` secildiginde dokuman kayitlarini, tum surumlerini ve S3 nesnelerini yeni storage anahtarlariyla cogaltiyor; dokumantasyon da bu davranisi yansitiyor.

- [x] **Demo veri seti ve seed scriptini hazirla**  
  `scripts/seed-demo.ts` tum semayi sifirlayip RBAC seed'ini calistirir, API uc noktalarini kullanarak 12 demo kullanici, 3 proje, ilgili gorev/dokuman/KPI verilerini, sistem ayarlarini ve API anahtarlarini olusturur; `npm run seed:demo` komutu calistirildiginda ayrintili cikti `docs/SEED_DATA.md` dosyasina kaydedilir.

- [x] **Bildirim servis/worker test kapsamını tamamla**  
  `tests/notifications/notification.service.test.ts` mock queue/prisma ile `dispatchSecondaryChannels` akışını doğruluyor; kullanıcı bulunduğunda IN_APP + WEBHOOK job payload'ları ve hata durumlarının swallow edilmesi jest düzeyinde güvence altına alındı.

- [x] **NotificationWorker için BullMQ entegrasyon testi yaz**  
  `tests/notifications/notification-worker.e2e.test.ts` izole test şemasında worker'ı ayağa kaldırıp BullMQ kuyruğundan gelen IN_APP job'larının Notification tablosuna yazıldığını, WEBHOOK job'larının ise mock `fetch` üzerinden imzalı payload gönderip `failureCount/lastDeliveredAt` alanlarını güncellediğini kanıtlıyor.

- [x] **In-app bildirim API’sinin filtre/sayfalama doğrulamasını test et**  
  `tests/notifications/in-app-notifications.e2e.test.ts` dosyasında status filtresi, pagination meta ve hatalı query senaryoları için yeni testler eklendi; `status=READ` filtreleri doğru sonuçları dönerken, geçersiz status/page/limit değerleri `422 VALIDATION_FAILED` ile yakalanıyor.

- [x] **Full-text aramada `search_vector` kolon uyumsuzluğunu gider**  
  `DocumentService`, `TaskService` ve global arama sorguları `search_vector` kolonunu kullanacak şekilde güncellendi; PostgreSQL tarafındaki `column ... does not exist` hataları giderildi ve `tests/search/full-text-search.e2e.test.ts` + `tests/search/search.e2e.test.ts` yeniden yeşile döndü.

- [x] **KPI otomasyon worker'ı için entegrasyon testleri ekle**  
  `tests/automation/kpi-monitoring.e2e.test.ts` yeniden yazılarak proje sağlığı hesaplaması ve KPI breach senaryoları doğrudan worker servisleriyle doğrulandı; `queueService.sendTemplateEmail` spy'ları beklenen payload'ların üretildiğini kanıtlıyor.

- [x] **Webhook bildirim sistemini gercekleştir**  
  Prisma `WebhookSubscription` modeli, Slack/Teams (JSON text payload) desteği ve `tests/notifications/webhook-subscriptions.e2e.test.ts` + `tests/notifications/notification-worker.e2e.test.ts` ile doğrulanan BullMQ tabanlı worker üzerinden outbound webhook teslimatı tamamlandı; `/api/v1/webhooks` rotası abonelik CRUD'unu sağlıyor.

- [x] **In-app bildirim/veritabanı modeli eksikliğini gider**  
  `Notification` modeli, `InAppNotificationService` ve `/api/v1/notifications` rotaları mevcut; `tests/notifications/in-app-notifications.e2e.test.ts` durum filtreleri + sayfalama doğrulamaları ile feed davranışını, `tests/notifications/notification.service.test.ts` ise queue üzerinden in-app job üretimini garanti altına alıyor.

- [ ] **Rapor export içeriklerini zenginleştir**  
  `src/http/controllers/report/reports.controller.ts` içinde excel/pdf çıktılarında sağlık skoru, geciken görev sayısı, harcanan bütçe ve risk tabloları halen `// TODO` olarak bırakılmış durumda. Proje/görev/KPI verilerini kullanarak gerçek değerleri hesapla ve çıktı şablonuna ekle.

- [ ] **Task monitor worker’da proje adı eksik**  
  `src/modules/automation/workers/task-monitor.worker.ts:227` satırında eskalasyon e-postaları için `projectName` boş string olarak gönderiliyor. Kuyruk job’larında projeyi yükleyip gerçek adı ekle.

- [ ] **KPI monitor worker sonuçlarını projeye yaz**  
  `src/modules/automation/workers/kpi-monitor.worker.ts:207` notunda hesaplanan sağlık skorunun `Project.healthScore` alanına persist edilmesi planlanmış ancak şema alanı yok. Schema + worker tarafında alanı ekleyip güncelle.

- [ ] **Doküman onay otomasyonundaki eksikleri tamamla**  
  `src/modules/automation/workers/document-approval.worker.ts` dosyasında approval zinciri, S3’te eski versiyonları temizleme ve ClamAV entegrasyonu TODO olarak duruyor. Onay sırasını gerçek approver listesine göre belirle, ihtiyaç halinde eski versiyonları sil ve virüs taramasını entegre et.

- [ ] **API key authentication’ı middleware seviyesine taşı**  
  `tests/users/api-keys.e2e.test.ts:335` üzerindeki TODO, API key’lerle kimlik doğrulama middleware’inin eksik olduğunu belirtiyor. HTTP katmanına API key doğrulaması ekleyip testleri güncelle.

- [x] **Dokuman API'sini belgelerle senkronize et**  
  `docs/PROJE_DURUM_RAPORU.md` yalnizca var olan upload/list/search/approve/link rotalarini anlatacak sekilde guncellendi; eksik CRUD/versiyon listesi roadmap olarak isaretlendi (08.11.2025).

- [x] **Audit log rapor ciktilarini expose et**  
  Teknik yol haritasi artik gercek endpoint olan `GET /api/v1/audit/export` referansini kullaniyor; `/api/v1/reports/audit` ifadesi kaldirildi (08.11.2025).

Bu liste yeni bulgulara gore guncellenecektir. Her madde tamamlandiginda isaretlenmeli ve ilgili PR/commit referansi eklenmelidir.

> Dokuman senkronizasyonu ve ayrintili revizyon maddeleri icin `docs/DOCS_BACKLOG.md` dosyasini, tamamlanan/planlanan isler icin bu belgeyi referans alin.

