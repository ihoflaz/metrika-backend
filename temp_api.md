# METRIKA ÖN YÜZ & API UYGULAMA KILAVUZU (AI AJAN SÜRÜMÜ)

Bu dosya; React tabanlı arayüzü otomatik olarak üretecek yapay zekâ ajanları ve ileri seviye frontend geliştiricileri için tek referans kaynağıdır. Kod tabanındaki Express/Prisma backend’ini bire bir yansıtır, tüm endpoint sözleşmelerini, izinlerini, hata kodlarını ve veri akışlarını eksiksiz sunar.

---

## 0. API Dokümantasyonu İçin En İyi Pratikler

Bu kılavuz; Stripe / Twilio tarzı modern API dokümanlarının temel prensiplerini izler:

1. **Amaç + Kapsam** – Her modül neden var, hangi kullanıcı aksiyonunu çözüyor? (Bölüm 2)
2. **Kimlik Doğrulama ve Yetkiler** – Token yaşam döngüsü, header formatı, izin matrisi (Bölüm 3).
3. **Sözleşme Standartları** – Ortak zarf yapısı (`data` + `meta`), sayfalama, filtreleme, hata nesneleri (Bölüm 4).
4. **Modül Referansı** – Her endpoint için yöntem, path, izin, istek/yanıt örnekleri, domain kuralları (Bölüm 5).
5. **Olay & Bildirim Kataloğu** – In-app feed, e-posta ve webhook payload’ları (Bölüm 6).
6. **Hata Kataloğu** – Kod + HTTP statüsü + önerilen UI davranışı (Bölüm 7).
7. **Test / Seed / Devflow** – Lokal doğrulama ve senaryo script’leri (Bölüm 8).
8. **Ekler** – Sık kullanılan enum listeleri ve izin matrisi (Bölüm 9).

> Bu yapı, OpenAPI/JSON:API tavsiyelerini ve Nielsen Norman “self-service API doc” rehberlerini baz alır: yüksek çözünürlüklü tablolar, örnekler, domain bağlamı ve değişiklik/güvenlik notları aynı yerde tutulur.

---

## 1. Servis Genel Bakış

| Özellik | Değer |
| --- | --- |
| **Base URL** | `http://localhost:3000/api/v1` (prod: `https://api.metrika.cloud/api/v1`) |
| **Versiyonlama** | URL tabanlı (`/api/v1`). Versiyon artışı breaking change olduğunda yapılır. |
| **Content-Type** | `application/json; charset=utf-8` (uploadlarda `multipart/form-data`) |
| **Kimlik Doğrulama** | JWT access token (15 dk) + refresh token (30 gün) |
| **Şema** | JSON:API benzeri zarf: `{ data: {...}, meta: {...} }` |
| **Request ID** | Backende gelen her istekte `X-Request-ID` yollayın; yanıt `meta.requestId` döner. |
| **Rate Limit** | Varsayılan 120 RPM / kullanıcı; limit aşımında `429 TOO_MANY_REQUESTS` + `Retry-After`. |

### 1.1 OTURUM YAŞAM DÖNGÜSÜ
1. **Login** – `POST /auth/login` kullanıcı + parola + optional MFA parametreleri gönderir, yanıt olarak access & refresh token alırsınız.
2. **Yetkili istek** – Her HTTP isteği `Authorization: Bearer <accessToken>` header’ı taşır.
3. **Otomatik yenileme** – 401 alındığında bir kez `POST /auth/refresh` çağrısı yapın. Başarısız olursa kullanıcıyı `/login`’e yönlendirin.
4. **Çıkış** – `POST /auth/logout` refresh token’ı revoke eder, server tarafında tekrar kullanılamaz.
5. **Şifre değişimi** – `POST /auth/change-password` (eski + yeni şifre) -> refresh token revoke edilir.

### 1.2 SİSTEM BİLEŞENLERİ
```
React SPA  ──fetch──►  API Gateway (Express) ──► Prisma/PostgreSQL
          │                          │
          ├─ Webhook yönetimi ◄──────┤
          ├─ SSE/Queue Monitoring ───┘
          └─ Seed/CLI script (ts-node) →
```
Arka planda BullMQ işçileri e-posta, KPI alarmı, PDF/Excel export gibi ağır işleri üstlenir.

---

## 2. Güvenlik, Roller, İzinler

### 2.1 JWT + Refresh Token
- Access token 15 dk, refresh token 30 gün geçerlidir. Token servisinde brute-force throttling ve gizli anahtar rotasyonu aktif (`AUTH_*_SECRET_FALLBACKS`, `AUTH_TOKEN_RATE_LIMIT_*`).
- Refresh token sızıntısı şüphesi varsa `POST /auth/logout` çağırıp `X-Device-Id` header’ı ile birlikte revoke edin.

### 2.2 İZİN MATRİSİ (Özet)

| Perm Kodu | Açıklama | Tipik Roller |
| --- | --- | --- |
| `project:read` / `project:write` | Proje listeleme / düzenleme / kapanış | PM, Sponsor |
| `task:read` / `task:write` | Görev CRUD, yorum, bağımlılık | PM, Takım lideri |
| `document:read` / `document:write` | Doküman / versiyon / link işlemleri | PMO, Denetçi |
| `kpi:read` / `kpi:create` / `kpi:write` | KPI oluşturma, değer girme, ihlal yönetimi | KPI steward |
| `report:read` | Portföy, KPI, görev raporları + export | Yönetim |
| `user:read` / `user:write` | Kullanıcı + rol yönetimi, API anahtarları | Sistem yöneticisi |
| `audit:read` | Denetim logu export | Güvenlik |
| `monitoring:manage` (SYSADMIN) | Kuyruk/cron kontrol, retry/pause | DevOps |

> Backend `requirePermissions` middleware’i yetkileri enforce eder; UI’de buton/aksiyon göstermeden önce aynı izinleri kontrol edin.

---

## 3. Ortak Sözleşme Kuralları

1. **JSON Zarfı**  
   ```json
   {
     "data": { "type": "project", "id": "...", "attributes": { ... } },
     "meta": {
       "requestId": "4cf7...",
       "pagination": { "page": 1, "limit": 20, "total": 120 }
     }
   }
   ```
2. **Sayfalama** – `page` (1-n), `limit` (varsayılan 20, max 100). Bazı listelerde `pageSize` sabit seçenekler (20/50/100). Yanıt `meta.pagination` döner.
3. **Sıralama & Filtreler** – `sortBy`, `sortOrder=asc|desc`, domain’e göre `status`, `sponsorId` vb query parametreleri.
4. **Tarih Formatı** – ISO8601 UTC (`2025-11-08T20:00:49.000Z`). Zod validasyonu var; UI tarih picker’dan gelen değerleri ISO’ya çevirin.
5. **Sayısal Alanlar** – Para & KPI değerleri decimal. JSON’da string döner (`"budgetPlanned": "120000.00"`).
6. **Dosya Yükleme** – `multipart/form-data` + field adı `file`. Max 150 MB. Virüs taraması (ClamAV) başarısızsa `DOCUMENT_VIRUS_DETECTED`.
7. **Hata Nesnesi** – `errors: [{ code, title, detail?, meta? }]`. Form doğrulama hataları `422` + field bazlı meta döner.
8. **Idempotency** – Finansal olmayan işlemler için gerekmez; kritik işlemlerde `Idempotency-Key` header’ı gönderilebilir (backend loglar ama enforce etmez).

---

## 4. Modül Referansı
Her modül için tablo + örnek verilmiştir. Yetki alanlarını UI seviyesinde de doğrulayın.

### 4.1 Kimlik Doğrulama

| Method | Path | Açıklama |
| --- | --- | --- |
| `POST` | `/auth/login` | Email + parola + isteğe bağlı MFA kodu ile giriş. |
| `POST` | `/auth/refresh` | Refresh token’ı gönderip yeni token çifti alır. |
| `POST` | `/auth/logout` | Refresh token’ı revoke eder. |
| `POST` | `/auth/change-password` | Mevcut şifre, yeni şifre, tekrarı. |

**Login isteği**
```json
{
  "email": "admin@metrika.local",
  "password": "ChangeMeNow123!",
  "mfaCode": "123456"
}
```
**Yanıt**
```json
{
  "data": {
    "type": "session",
    "attributes": {
      "user": { "id": "019a...", "fullName": "Admin" },
      "accessToken": "...",
      "refreshToken": "...",
      "expiresIn": 900
    }
  },
  "meta": { "requestId": "..." }
}
```
UI; access token’ı memory’de, refresh token’ı httpOnly cookie’de saklamalı.

### 4.2 Kullanıcılar & RBAC

| Method | Path | Permission | Açıklama |
| --- | --- | --- | --- |
| `GET` | `/users` | `user:read` | Filtreli kullanıcı listesi (`status`, `role`, `search`). |
| `POST` | `/users` | `user:write` | Kullanıcı daveti/oluşturma (email, fullName, roller). |
| `GET` | `/users/me` | `user:read` | Oturum sahibi profil bilgisi. |
| `GET` | `/users/me/email-logs` | `user:read` | Kullanıcının aldığı e-posta logları. |
| `GET` | `/users/:id` | `user:read` | Detay. |
| `PATCH` | `/users/:id` | `user:write` | Ad, roller, durum güncelleme. |
| `DELETE` | `/users/:id` | `user:write` | Kullanıcıyı pasifleştirir (hard delete yok). |
| `POST` | `/users/:id/activate` | `user:write` | Pasif kullanıcıyı yeniden aktifleştirir. |

**Create payload alanları**: `email`, `fullName`, `roles[]`, `status?`, `temporaryPassword?`. UI davet akışında şifre üretip kullanıcıya mail göndermek için backend template kullanır; UI sadece onay mesajı gösterir.

### 4.3 API Anahtarları

Base path `/api/v1/api-keys` (auth zorunlu, kullanıcı kendi anahtarlarını yönetir).

| Method | Path | Açıklama |
| --- | --- | --- |
| `POST /` | Yeni API anahtarı üretir; `meta.plainKey` sadece ilk yanıt sırasında gelir. |
| `GET /` | Listeler (`lastUsedAt`, `label`, `scopes`). |
| `GET /:id` | Detay. |
| `PATCH /:id` | Label/scopes güncelleme. |
| `POST /:id/revoke` | Aktif anahtarı iptal eder. |
| `DELETE /:id` | Silme (revoke + kayıt temizleme). |

### 4.4 Projeler

| Method | Path | Permission | Not |
| --- | --- | --- | --- |
| `POST` | `/projects` | `project:write` | Sponsor, tarih aralığı, opsiyonel PMO, bütçe. |
| `GET` | `/projects` | `project:read` | Sayfalı liste (status, sponsor, tarih filtreleri). |
| `GET` | `/projects/search` | `project:read` | Kod/ad araması. |
| `GET` | `/projects/:id` | `project:read` | Detay. |
| `PATCH` | `/projects/:id` | `project:write` | Kısmi güncelleme (status dahil). |
| `POST` | `/projects/:id/close` | `project:write` | İnceleme: açık görev, doküman, KPI ihlali varsa 400 döner. |
| `POST` | `/projects/:id/reopen` | `project:write` | CLOSED/CANCELLED → ACTIVE. |
| `GET` | `/projects/:id/closure-report` | `project:read` | PDF (blob). |
| `GET` | `/projects/:id/kanban` | `project:read` | Kolon bazlı görevler. |
| `POST` | `/projects/:id/kanban/reorder` | `project:write` | Kart sırası güncelleme. |
| `GET` | `/projects/:id/gantt` | `project:read` | Gantt veri seti. |
| `POST` | `/projects/:id/clone` | `project:write` | Var olan projeden kopya. |
| `POST` | `/projects/:id/mark-as-template` | `project:write` | Şablon olarak işaretler. |
| `GET` | `/projects/templates/list` | `project:read` | Tüm kullanılabilir şablonlar. |
| `POST` | `/projects/templates/:templateId/clone` | `project:write` | Şablondan kopya. |

**Kapanış hata kodları**
- `PROJECT_HAS_INCOMPLETE_TASKS`
- `PROJECT_PENDING_DOCUMENT_APPROVALS`
- `PROJECT_PENDING_KPI_BREACHES`

UI bu kodlara göre bloklayan listeyi göstermek için ilgili modül API’lerini (tasks/documents/kpi) çağırmalıdır.

### 4.5 Proje Üyelikleri

| Method | Path | Açıklama |
| --- | --- | --- |
| `POST /projects/:projectId/members` | Kullanıcıyı projeye rol (PM/Lead/Contributor/Reviewer) ile ekler. |
| `GET /projects/:projectId/members` | Proje üyelerini listeler. |
| `GET /members/:memberId` | Tek üyeyi getirir. |
| `PATCH /members/:memberId` | Rol / allocation güncelleme. |
| `DELETE /members/:memberId` | Üyeyi projeden çıkarır. |

### 4.6 Görevler

| Method | Path | Permission | Açıklama |
| --- | --- | --- | --- |
| `POST` | `/projects/:projectId/tasks` | `task:write` | Proje bağlamında görev oluşturur. |
| `GET` | `/projects/:projectId/tasks` | `task:read` | Proje görevleri (sayfalı). |
| `GET` | `/tasks` | `task:read` | Tüm görevler (global filtreler). |
| `GET` | `/tasks/search` | `task:read` | Metin + filtre araması. |
| `GET` | `/tasks/:taskId` | `task:read` | Detay. |
| `PATCH` | `/tasks/:taskId` | `task:write` | Alan bazlı güncelleme. |
| `DELETE` | `/tasks/:taskId` | `task:write` | Silme (soft delete yok, doğrudan remove). |
| `PATCH` | `/tasks/:taskId/move` | `task:write` | Kanban kolonu/sıra güncelleme. |
| `GET/POST/DELETE` | `/tasks/:taskId/dependencies` | `task:*` | Bağımlılık CRUD. |
| `GET/POST/PATCH/DELETE` | `/tasks/:taskId/comments` | `task:*` | Yorum CRUD. |
| `GET/POST/DELETE` | `/tasks/:taskId/watchers` | `task:*` | İzleyici yönetimi. |
| `GET` | `/tasks/:taskId/documents` | `task:read` | Linked dokümanlar. |
| `POST` | `/tasks/bulk/*` | `task:write` | Bulk update/delete/status/watchers. |
| `GET` | `/tasks/bulk/stats/:projectId` | `project:read` | Toplu aksiyon öncesi özet. |

**Önemli doğrulamalar**
- Bağımlılık eklerken dairesel referansa izin yok → `TASK_DEPENDENCY_CYCLE`.
- Kanban move isteği `columnId`, `position` alanları bekler; UI optimistic update yapabilir.

### 4.7 Dokümanlar & Versiyonlar

| Method | Path | Permission | Not |
| --- | --- | --- | --- |
| `POST` | `/projects/:projectId/documents` | `document:write` | Yeni doküman + ilk versiyon upload (multipart). |
| `GET` | `/documents` | `document:read` | Filtreler: `projectId`, `docType`, `classification`, `tags`, `search`. |
| `GET` | `/documents/search` | `document:read` | Full-text (code/title/tags). |
| `GET` | `/documents/:id` | `document:read` | Detay + tüm versiyonlar + onaylar. |
| `GET` | `/documents/:id/download` | `document:read` | Güncel versiyonu indirir. |
| `POST` | `/documents/:id/versions` | `document:write` | Yeni versiyon yükleme, opsiyonel `versionLabel`. |
| `POST` | `/documents/:id/versions/:versionId/approve` | `document:write` | `decision=APPROVED|REJECTED`, `comment`. |
| `POST` | `/documents/:id/link-task` | `document:write` | Dokümanı göreve bağlar. |
| `DELETE` | `/documents/:id/unlink-task/:taskId` | `document:write` | Bağlantıyı koparır. |
| `GET` | `/documents/:id/tasks` | `document:read` | Linkli görevler. |

**Upload alanları**: `title`, `docType`, `classification`, `ownerId`, `retentionPolicy`, opsiyonel `tags[]`, `linkedTaskIds[]`, `linkedKpiIds[]`. Dosya inputu `file`.

**Hata kodları**: `DOCUMENT_FILE_INVALID`, `DOCUMENT_FILE_TOO_LARGE`, `DOCUMENT_VIRUS_DETECTED`, `DOCUMENT_VERSION_NOT_FOUND`, `DOCUMENT_VERSION_ARCHIVED`.

### 4.8 KPI & İhlal Yönetimi

| Method | Path | Permission | Açıklama |
| --- | --- | --- | --- |
| `POST` | `/kpis` | `kpi:create` | Yeni KPI tanımı. |
| `GET` | `/kpis` | `kpi:read` | Liste (kategori, durum, steward filtreleri). |
| `GET` | `/kpis/breaches` | `kpi:read` | Aktif ihlaller. |
| `POST` | `/kpis/breaches/process` | `kpi:write` | Tüm ihlaller için corrective task tetikler. |
| `GET` | `/kpis/:id` | `kpi:read` | Detay + son veri. |
| `PATCH` | `/kpis/:id` | `kpi:write` | Güncelleme. |
| `POST` | `/kpis/:id/retire` | `kpi:write` | KPI’yı emekliye ayırır. |
| `POST` | `/kpis/:id/values` | `kpi:write` | Veri noktası ekleme (`value`, `recordedAt`, `source`). |
| `GET` | `/kpis/:id/trend` | `kpi:read` | Trend verisi (chart). |
| `GET` | `/kpis/:id/threshold-check` | `kpi:read` | Güncel değer eşik aşıyor mu? |
| `GET` | `/kpis/:id/breach-status` | `kpi:read` | Belirli KPI ihlal bilgisi. |
| `POST` | `/kpis/:id/corrective-action` | `kpi:write` | Manuel aksiyon. |
| `GET` | `/kpis/:id/export` | `kpi:read` + `report:read` | Excel export. |

**Hata kodları**: `KPI_RETIRE_NOT_ALLOWED`, `KPI_ALREADY_RETIRED`, `KPI_VALUE_OUT_OF_RANGE`, `KPI_BREACH_ALREADY_RESOLVED`.

### 4.9 Raporlar & Exportlar

Base path `/reports` (JSON) + `/reports/*/export` (Excel) + `/reports/*/export/pdf`.

| Endpoint | Açıklama |
| --- | --- |
| `GET /reports/portfolio-summary` | Aktif projeler, bütçe, durum dağılımı. |
| `GET /reports/kpi-dashboard` | KPI trend + ihlal özetleri. |
| `GET /reports/task-metrics` | Görev throughput, cycle time. |
| `GET /reports/portfolio-summary/export(.pdf)` | Excel / PDF sürüm. |
| `GET /reports/kpi-dashboard/export(.pdf)` | Excel / PDF. |
| `GET /reports/task-metrics/export` | Excel. |

Ek olarak `/api/v1/projects/:id/closure-report` PDF döner, `/api/v1/export/*` rotaları (tasks Excel/PDF) özel filtreli exportlar sağlar. UI blob isteğini `fetch` ile çekip `URL.createObjectURL` üzerinden indirmeli.

### 4.10 Bildirimler (In-App + E-posta)

| Method | Path | Açıklama |
| --- | --- | --- |
| `GET /notifications` | `status`, `page`, `limit` filtreli feed. |
| `POST /notifications/:id/read` | Tek bildirimi okundu işaretler. |
| `POST /notifications/:id/archive` | Feed’den kaldırır (arka planda `status=ARCHIVED`). |
| `POST /notifications/read-all` | Kullanıcının tüm bildirilerini okundu yapar. |

Backend `Notification` modeli `type`, `title`, `message`, `data` alanlarını içerir. Email bildirimleri MailHog/SMTP üzerinden aynı şablon bilgilerini kullanır; UI feed kartında `data` içindeki `projectCode`, `taskId` vb alanları derin link için kullanabilir.

### 4.11 Webhook + Slack/Teams Entegrasyonu

| Method | Path | Açıklama |
| --- | --- | --- |
| `GET /webhooks` | Tüm abonelikler. |
| `POST /webhooks` | `{ name, url, events[], channel?, secret? }`. `meta.secret` sadece ilk yanıtla gelir. |
| `PATCH /webhooks/:id` | Ad, URL, event seti, `channel`, `isActive`, `rotateSecret`. |
| `DELETE /webhooks/:id` | Aboneliği kaldırır. |

**Desteklenen `events[]`:**
- `project.closed`, `project.reopened`
- `task.created`, `task.updated`, `task.commented`
- `document.version_submitted`, `document.approved`
- `kpi.breached`, `kpi.corrective_action`
- `user.invited`, `user.deactivated`

Payload örneği:
```json
{
  "id": "evt_019a65...",
  "type": "task.commented",
  "occurredAt": "2025-11-08T20:00:49.000Z",
  "data": {
    "taskId": "019a650e-a476-7be9-bfe5-242548fb7b0a",
    "projectId": "019a64ff-72a2-...",
    "comment": {
      "id": "...",
      "authorId": "019a64f2...",
      "body": "Integration API Design için öncelik high..."
    }
  },
  "meta": {
    "webhookId": "wh_01...",
    "signature": "sha256=..."
  }
}
```
Slack/Teams kanallarında `channel` alanı `SLACK` / `TEAMS` olduğunda servis payload’ı uygun biçime çevirir; UI abonelik oluştururken webhook URL formatını doğrulamalı.

### 4.12 Kullanıcı Tercihleri ve Sistem Ayarları

**User Preferences** – `/api/v1/user/preferences`

| Endpoint | Açıklama |
| --- | --- |
| `GET /notifications` | Email/in-app tercihleri. |
| `GET /ui` | Tema, tablo görünümü vb. |
| `GET /export` | Tüm tercihleri JSON olarak indir. |
| `POST /import` | JSON upload edip bulk set. |
| `POST /bulk` | `{ items: [{ key, value }] }`. |
| `GET /` | Tüm anahtarlar veya `keys=foo,bar`. |
| `DELETE /` | Tüm tercihleri temizler. |
| `GET/PUT/DELETE /:key` | Tekil tercih yönetimi. |

**System Settings** – `/api/v1/settings`

- `GET /public` auth gerektirmez (örn. logo URL, destek maili).  
- Diğer tüm rotalar auth + izin kontrolü içerir (`user:write`, `report:read` vs middleware içinde).  
- CRUD + `POST /clear-cache`, `POST /bulk-update`, `GET /by-category`.

### 4.13 Arama

`GET /search`:
- Parametreler: `q` (zorunlu), `type=` TASK|PROJECT|DOCUMENT|KPI (array olabilir), `projectId`, `limit` (<=100), `minSimilarity` (0-1).
- Yanıt: `data[]` içinde `type`, `id`, `score`, `attributes` (özet alanlar). PostgreSQL `pg_trgm` ile fuzzy skorlar döner.

### 4.14 Audit & Monitoring

- `GET /audit/export` → CSV/NDJSON audit log (tarih aralığı query parametreleri: `from`, `to`, `actorId`, `eventCode`). `audit:read` gerektirir.
- `/queues` router:  
  - `GET /queues/metrics` → BullMQ kuyruk metrikleri  
  - `GET /queues/cron-status` → Cron job’ların durumu
- `/monitoring/queues` router:  
  - `GET /` → tüm kuyruklar  
  - `GET /:queueName` → detay  
  - `POST /:queueName/retry`, `DELETE /:queueName/clean`, `PATCH /:queueName/pause`
- `GET /healthz`, `/readyz` → yük dengeleyici kontrolleri için genel durum.

### 4.15 Unsubscribe & Email Logları

- `GET /unsubscribe/:token` (public) – Email altbilgisindeki link kullanıcıyı UI’deki sayfaya yönlendirir; token backend’de doğrulanır ve ilgili notification tipleri kapatılır.
- `GET /users/me/email-logs` – Kullanıcının aldığı son 100 e-postayı döner (konu, template, status, messageId).

### 4.16 Seed & Demo Verileri

- Script: `npm run seed:demo` (önce backend ve PostgreSQL çalışır olmalı, `.env` kullanılacak).  
- İşlem akışı:
  1. Prisma ile tüm tablo verileri temizlenir ( `_prisma_migrations` hariç).
  2. RBAC, sistem ayarları, referans veriler eklenir.
  3. API üzerinden (HTTP) 10+ kullanıcı, projeler, görevler, dokümanlar, KPI’lar, API key, unsubscribe token, notification feed vs oluşturulur.
  4. Özet `docs/SEED_DATA.md` dosyasına yazılır.
- Script API çağrılarını `admin@metrika.local / ChangeMeNow123!` ile yapar; UI tarafında aynı verilerle çalışabilirsiniz.

---

## 5. Olay & Bildirim Kataloğu

### 5.1 In-App Bildirim Tipleri

| Tip | Tetikleyici | `data` Alanları |
| --- | --- | --- |
| `task.commented` | Yeni yorum | `taskId`, `projectId`, `commentId`, `authorId`, `excerpt`. |
| `task.assigned` | Görev devri | `taskId`, `oldOwnerId`, `newOwnerId`. |
| `project.status_changed` | Proje durum değişikliği | `projectId`, `oldStatus`, `newStatus`. |
| `document.version_submitted` | Yeni versiyon | `documentId`, `versionId`, `title`. |
| `document.version_approved` | Onay sonucu | `documentId`, `versionId`, `decision`, `approverId`. |
| `kpi.breached` | KPI eşik ihlali | `kpiId`, `severity`, `currentValue`, `threshold`. |
| `report.ready` | Export tamamlandı | `exportId`, `downloadUrl`. |

Feed UI’sı, her tip için ikon + CTA belirlemelidir (örn. `taskId` linki `/tasks/:id`).

### 5.2 Webhook Payload Alanları

Tüm webhooklar şu alanlara sahiptir:
- `id` – event ID
- `type` – tablo yukarısı
- `occurredAt`
- `data` – domain objesi (Task/Project/Document/KPI)
- `meta.requestId`
- `meta.signature` – `sha256=HMAC(secret, body)`; UI admin paneli secret’ı gösterir.

Retry politikası: 5xx veya timeout durumunda 3 kez exponential backoff ile tekrar dener, başarısız olursa abonelik `failureCount` artırılır ve `notifications` modülüne sysadmin bildirimi düşer.

---

## 6. Hata Kataloğu ve UI Davranışı

| Kod | HTTP | Ne Zaman | UI Önerisi |
| --- | --- | --- | --- |
| `AUTH_UNAUTHORIZED` | 401 | Token yok / geçersiz | Refresh → Login’e yönlendir, oturum verisini temizle. |
| `AUTH_FORBIDDEN` | 403 | İzin eksik | Toast “Bu işlem için yetkiniz yok”, butonu disable et. |
| `VALIDATION_FAILED` | 422 | Form hatası | Field bazlı hata göster, formu highlight et. |
| `PROJECT_HAS_INCOMPLETE_TASKS` | 400 | Kapanışta açık task | Modal ile bloklayan görev listesi (GET `/tasks?status!=COMPLETED`). |
| `PROJECT_PENDING_DOCUMENT_APPROVALS` | 400 | Kapanışta bekleyen doküman | `/documents?projectId=...&status=IN_REVIEW`. |
| `PROJECT_PENDING_KPI_BREACHES` | 400 | Kapanışta ihlal | `/kpis/breaches?projectId=...`. |
| `TASK_DEPENDENCY_CYCLE` | 400 | Döngüsel bağımlılık | Toast + graph highlight. |
| `DOCUMENT_FILE_TOO_LARGE` | 400 | >150 MB upload | Kullanıcıya limit + önerilen sıkıştırma bilgisini göster. |
| `DOCUMENT_VIRUS_DETECTED` | 400 | AV tespit | Uyarı + rapor ID. |
| `DOCUMENT_VERSION_NOT_FOUND` | 404 | Versiyon ID hatalı | UI’daki listeyi yenile. |
| `KPI_BREACH_ALREADY_RESOLVED` | 409 | Aynı ihlal tekrar işlenmek isteniyor | Toast + sayfayı yenile. |
| `RESOURCE_CONFLICT` | 409 | Genel çakışma | Özel `meta` alanını UI’da göster. |
| `NOT_FOUND` | 404 | Yanlış path/id | Breadcrumb’da “kayıt bulunamadı” ekranı. |
| `TOO_MANY_REQUESTS` | 429 | Rate limit | `Retry-After` değerine göre disable. |

Tüm hatalar `meta.requestId` taşır; kullanıcı şikayetlerinde bu ID’yi loglardan eşleyin.

---

## 7. Test, Seed ve QA Akışı

1. **Birim & e2e testleri**  
   ```bash
   npm test -- --runTestsByPath tests/auth/auth.e2e.test.ts
   npm test -- --runTestsByPath tests/projects/project-closure.e2e.test.ts
   npm test -- --runTestsByPath tests/notifications/in-app-notifications.e2e.test.ts
   ```
   - Prisma migrate deploy step’i her test öncesi çalışır; “Schema engine error” alırsanız komutu tekrar çalıştırın (bilinen Prisma issue).

2. **Seed**  
   ```bash
   npm run seed:demo
   ```
   - Önce Docker/Postgres ve API ayakta olmalı.  
   - Komut tüm veriyi silip yeniden doldurur, `docs/SEED_DATA.md` içinde tablo içeren bir özet oluşturur.

3. **Manual QA senaryoları**  
   - Login → refresh → logout akışı  
   - Proje oluşturma → görev/bağımlılık → doküman upload → KPI gir → proje kapat  
   - In-app bildirimleri okuma/arsivleme  
   - Webhook kayıt et, Slack test kanalına POST gittiğini MailHog ile doğrula  
   - Export / download butonları (Blob)  
   - Kullanıcı CRUD + API key üretimi

---

## 8. Ekler

### 8.1 Sık Kullanılan Enumlar

- `ProjectStatus`: `PLANNING | ACTIVE | ON_HOLD | CLOSED | CANCELLED`
- `TaskStatus`: `DRAFT | PLANNED | IN_PROGRESS | BLOCKED | ON_HOLD | COMPLETED | CANCELLED`
- `TaskPriority`: `LOW | NORMAL | HIGH | CRITICAL`
- `DocumentType`: `CONTRACT | REPORT | PLAN | REQUIREMENT | RISK | GENERIC | CUSTOM`
- `DocumentVersionStatus`: `DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED`
- `KPIStatus`: `PROPOSED | UNDER_REVIEW | ACTIVE | MONITORING | BREACHED | RETIRED`
- `NotificationStatus`: `UNREAD | READ | ARCHIVED`
- `WebhookChannel`: `GENERIC | SLACK | TEAMS`

### 8.2 İzin → Özellik Haritası

| İzin | Ekran / Özellik |
| --- | --- |
| `project:read` | Proje listesi, detay, Kanban, Gantt, kapanış PDF indirme |
| `project:write` | Proje oluşturma, güncelleme, kapanış/reopen, şablon, üyelik yönetimi |
| `task:read` | Görev listesi, detay, yorum ve watchers görüntüleme |
| `task:write` | Görev oluşturma, düzenleme, silme, bağımlılık, watchers, bulk işlemler |
| `document:read` | Doküman listesi, arama, indirme |
| `document:write` | Upload, yeni versiyon, onay, görev linkleme |
| `kpi:read` | KPI listesi, trend, ihlal listesi |
| `kpi:write` | KPI güncelleme, veri girişi, corrective action |
| `kpi:create` | KPI tanımı oluşturma |
| `report:read` | Dashboard, export, PDF |
| `user:read` | Kullanıcı listesi, me endpointi, email logları |
| `user:write` | Kullanıcı CRUD, rol atama, API anahtarı yönetimi, webhook yönetimi |
| `audit:read` | Audit export |
| `monitoring:manage` | Queue/cron operasyonları |

### 8.3 Geliştirici İpuçları

- Tüm fetcher fonksiyonları response’tan `meta.requestId` ve `X-Request-ID` header’ını Sentry breadcrumb’ına yazmalı.
- React Query `queryKey` tasarımı: `['projects', { page, filters }]`, `['tasks', taskId]`, `['documents', docId, 'versions']`.
- Dosya upload komponenti; `Content-Type` otomatik ayarlansın diye `FormData` kullanın, `fetch` API’si yeterli.
- Download (PDF/Excel) için `await fetch` → `blob()` → `URL.createObjectURL` + geçici `<a>`.
- Webhook oluşturma modalında secret key bir kez gösterildiği için kullanıcıyı kopyalamaya zorlayan bir step ekleyin.

---

Bu kılavuz, backend ile haberleşmek için gereken tüm sözleşmeleri içerir. Yeni bir endpoint veya domain kuralı deploy edildiğinde bu dosya güncellenmedikçe değişiklik “tamamlanmış” sayılmaz. Sorular için `#metrika-backend` Slack kanalı veya `docs/DOCS_BACKLOG.md` üzerindeki görevler referans alınmalıdır.
