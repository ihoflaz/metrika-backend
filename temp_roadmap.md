# Metrika Backend Teknik Yol Haritasi

Bu dokuman, METRIKA_AKADEMIK_MAKALE_FINAL.md uzerindeki kavramsal modele dayanarak, orta olcekli yerli sirketlerde kullanilacak Metrika platformunun backend gelistirme calismalari icin ayrintili teknik yol haritasini sunar. Belge; gereksinim analizi, veri modeli, is akislari, endpoint taslagi, mimari kararlar ve 8 haftalik teslimat planini icermektedir.

> Güncel durum (08.11.2025): Bu yol haritası kod tabanındaki gerçek şema ve modüllerle uyumlu olacak şekilde kademeli olarak güncellenmektedir; açık maddeler için `docs/DOCS_BACKLOG.md` ve `docs/PROJECT_TODO.md` dosyalarına bakınız.

## 1. Proje Baglami ve Amaci
- Gorev, dokuman ve metrik (KPI) verilerini tek catri altinda toplamak.
- Operasyonel baglam kaybini ortadan kaldirip karar destek sureclerini hizlandirmak.
- 20 es zamanli proje, 500 kayitli kullanici ve 250-300 es zamanli aktif oturum hedeflerini desteklemek.
- Hassas ticari ve kişisel verileri KVKK ve iyi uygulamalar dogrultusunda korumak.

## 2. Varsayimlar ve Kişitlar
- Kurum tipi: Orta olcekli yerli sirket, coklu departman ve proje takimi.
- Sure: 8 haftalik MVP teslimati; dokuman yasayan belge olarak guncellenecek.
- Kimlik dogrulama ve sifre politikasi backend tarafindan saglanacak, dis SSO zorunlu degil.
- Dosya icerikleri AWS S3 uyumlu depolamada saklanacak (lokalde MinIO).
- Uyumluluk: KVKK ve kurum icin iyi uygulamalar; ISO 27001 benzeri standartlar “nice-to-have”.
- Tumuyle web bazli kullanim (mobil istemci sonraki faz).

## 3. Paydaslar ve Roller
| Rol | Aciklama | Ornek Yetkiler |
| --- | --- | --- |
| Sistem Sahibi | Ust duzey sponsor, SLA ve yatirim kararlarini verir | Stratejik raporlar, konfigurasyon onaylari |
| Platform Yonetici (SysAdmin) | Uygulama ve altyapi yonetimi | Kullanici/rol yonetimi, sistem ayarlari |
| PMO Lideri | Proje portfoyunu denetler | Proje olusturma, standartlarin tanimi, raporlar |
| Proje Yoneticisi (PM) | Proje ekiplerini yonetir | Gorev dagitimi, dokuman onayi, KPI izleme |
| Takim Uyesi | Gorevleri yerine getirir | Gorev gorevleri goruntuleme/guncelleme, yorum, belge erisimi |
| Dokuman Yoneticisi | Dokuman yasam dongusunu kontrol eder | Dokuman yukleme, versiyonlama, yayin/onay |
| KPI Analisti | KPI sozlugunu ve raporlarini gunceller | KPI tanimlama, veri toplama, sapma analizleri |
| Denetci / Kalite | Uyumluluk ve audit faaliyetleri | Okuma erisimleri, audit log inceleme |
| Entegrasyon Servis Hesabi | Sistemler arasi veri akişi | Kisitli servis token’lari ile API erisimi |

## 4. Ayrintili Yazilim Gereksinimleri Analizi

### 4.1 Is Hedefleri
1. Gorev, dokuman, metrik verilerini baglamsal olarak iliskilendirmek.
2. Ekipler arasi seffaflik ve izlenebilirligi artirmak.
3. KPI performans takibini otomatiklestirmek.
4. Kurumsal hafiza olusumu icin audit edilen ve arastirilabilir kayitlar sunmak.

### 4.2 Domain Kapsami ve Varliklar
Tum kimlik alanlari UUID v7 formatinda tutulacak. Zaman damgalari ISO-8601.

#### 4.2.1 Proje Varligi
| Alan | Tip | Zorunlu | Aciklama |
| --- | --- | --- | --- |
| id | uuid | Evet | Benzersiz proje kimligi |
| code | string(12) | Evet | Insan okunabilir kod (unique) |
| name | string(120) | Evet | Proje adi |
| description | text | Hayir | Ozet |
| sponsor_id | uuid | Evet | Sistem sahibi veya ust yonetici |
| pmo_owner_id | uuid | Hayir | PMO lideri referansi |
| status | enum(planning, active, on_hold, closed, cancelled) | Evet | Proje durumu |
| start_date | date | Evet | Planlanan baslangic |
| end_date | date | Hayir | Planlanan bitis |
| actual_start | datetime | Hayir | Gercek baslangic |
| actual_end | datetime | Hayir | Gercek bitis |
| budget_planned | decimal | Hayir | Planlanan butce |
| metadata | jsonb | Hayir | Ozellestirilebilir alanlar |
| created_at / updated_at | datetime | Evet | Audit alanlari |

#### 4.2.2 Proje Uye Varligi
| Alan | Tip | Aciklama |
| --- | --- | --- |
| id | uuid | Kayit kimligi |
| project_id | uuid | Proje referansi |
| user_id | uuid | Kullanici referansi |
| role | enum(pm, lead, contributor, reviewer) | Projedeki rol |
| allocation_pct | int | Kaynak yuzdesi |
| joined_at / left_at | datetime | Takip |

#### 4.2.3 Gorev Varligi
| Alan | Tip | Zorunlu | Aciklama |
| --- | --- | --- | --- |
| id | uuid | Evet | Gorev kimligi |
| project_id | uuid | Evet | Proje baglantisi |
| parent_task_id | uuid | Hayir | Alt gorev referansi |
| title | string(160) | Evet | Gorev basligi |
| description | text | Hayir | Detay |
| status | enum(planned, in_progress, blocked, on_hold, completed, cancelled) | Evet | Yasam dongusu |
| priority | enum(low, normal, high, critical) | Hayir | Oncelik |
| owner_id | uuid | Evet | Sorumlu kisi |
| reporter_id | uuid | Hayir | Gorevi acan kisi |
| planned_start / planned_end | datetime | Hayir | Planlanan takvim |
| actual_start / actual_end | datetime | Hayir | Gerceklesen takvim |
| progress_pct | int | Evet | %0-100 |
| effort_planned_hours | decimal | Hayir | Tahmini emek |
| effort_logged_hours | decimal | Hayir | Gerceklesen emek |
| metadata | jsonb | Hayir | Risk/etiket gibi baglamsal veriler icin serbest alan |
| created_at / updated_at | datetime | Evet | Audit |

#### 4.2.4 Gorev Bagimlilik Varligi
| Alan | Tip | Aciklama |
| --- | --- | --- |
| id | uuid | |
| task_id | uuid | Bagimli gorev |
| depends_on_id | uuid | Once yapilmasi gereken gorev |
| type | enum(fs, sf, ff, ss) | Finish-Start vb. |
| lag_minutes | int | Pozitif/negatif sapma |

#### 4.2.5 Dokuman Varligi
| Alan | Tip | Zorunlu | Aciklama |
| --- | --- | --- | --- |
| id | uuid | Evet | Dokuman kimligi |
| project_id | uuid | Evet | Proje baglantisi |
| title | string(160) | Evet | Dokuman adi |
| doc_type | enum(contract, report, plan, requirement, risk, generic, custom) | Evet | Sabit enum; yeni tur icin migration gerekir |
| classification | enum(public, internal, confidential, restricted) | Evet | Gizlilik seviyesi |
| owner_id | uuid | Evet | Dokuman sahibi |
| storage_key | string | Evet | S3 nesne yolu |
| current_version_id | uuid | Evet | Aktif versiyon |
| tags | string[] | Hayir | Serbest etiket |
| linked_task_ids | uuid[] | Hayir | Iliskili gorevler |
| linked_kpi_ids | uuid[] | Hayir | Iliskili KPI'lar |
| retention_policy | enum(default, long_term, legal_hold) | Evet | Saklama |
| created_at / updated_at | datetime | Evet | Audit |

Dokuman turleri Prisma enum'u ile sinirli; admin panelinden dinamik ekleme yapilmamaktadir (gelecek faz icin degerlendirilecek). Etiket (tag) alanlari serbest metin, fakat sozluk onerileri ileride eklenebilir.

#### 4.2.6 Dokuman Versiyon Varligi
| Alan | Tip | Aciklama |
| --- | --- | --- |
| id | uuid | Versiyon kimligi |
| document_id | uuid | Ust kayit |
| version_no | string | SemVer benzeri (major.minor.patch) |
| status | enum(draft, in_review, approved, published, archived) |
| checksum | string | SHA-256 |
| size_bytes | bigint | Dosya boyutu (max 150MB) |
| mime_type | string | Desteklenen tipler (pdf, docx, xlsx, pptx, msg, jpg, png, zip) |
| virus_scan_status | enum(pending, clean, infected, bypassed) |
| approval_chain | jsonb | Onaylayan kullanicilar ve zaman damgalari |
| created_by | uuid | Yukleyen kisi |
| created_at | datetime | |

#### 4.2.7 KPI (Metrik) Varligi
| Alan | Tip | Zorunlu | Aciklama |
| --- | --- | --- | --- |
| id | uuid | Evet | KPI kimligi |
| code | string(20) | Evet | Benzersiz kod |
| name | string(160) | Evet | KPI adi |
| description | text | Hayir | Detay |
| category | enum(financial, schedule, quality, resource, compliance, custom) | Evet | Tur |
| calculation_formula | text | Evet | Matematiksel ifade (LaTeX benzeri string) |
| target_value | decimal | Evet | Hedef |
| unit | string(32) | Evet | Birim (%, gun, adet, TL vb.) |
| threshold_warning | decimal | Hayir | Uyari esigi |
| threshold_critical | decimal | Hayir | Kritik esik |
| aggregation_period | enum(weekly, monthly, quarterly, yearly) | Evet | Donem |
| data_source_type | enum(manual, system, hybrid) | Evet | Veri toplama tipi |
| data_source_reference | jsonb | Hayir | Sistem baglantisi veya form alanlari |
| steward_id | uuid | Evet | KPI sorumlusu |
| approver_id | uuid | Hayir | Onaylayici |
| status | enum(proposed, under_review, active, monitoring, breached, retired) | Evet | Yasam dongusu |
| privacy_level | enum(public, internal, restricted) | Evet | Erisim |
| created_at / updated_at | datetime | Evet | Audit |

#### 4.2.8 KPI Veri Serisi
| Alan | Tip | Aciklama |
| --- | --- | --- |
| id | uuid | |
| kpi_id | uuid | |
| period_start / period_end | date | Donem |
| actual_value | decimal | Gerceklesen |
| value_source | enum(manual_entry, api_ingest, file_upload) |
| collected_at | datetime | |
| collected_by | uuid | Manuel ise kullanici |
| verification_status | enum(pending, verified, rejected) |
| verification_notes | text | |

#### 4.2.9 Diger Varliklar
- **Notification**: Kullaniciya gonderilen bildirimler (email; webhook desteği roadmap'te).
- **Comment**: Gorev ve dokuman uzerindeki yorumlar.
- **Audit Log**: Tum kritik degisiklikler (immutable).
- **Attachment**: Gorev/KPI icin ekstra dosya baglari.
- **Webhook Subscription**: Gerektiginde dis sistemleri tetiklemek icin.

### 4.3 Roller ve Yetki Matrisi

| Yetki / Modul | SysAdmin | PMO Lideri | Proje Yoneticisi | Takim Uyesi | Dokuman Yoneticisi | KPI Analisti | Denetci |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kullanici/Rol Yonetimi | R | R | - | - | - | - | - |
| Proje Olusturma/Kapatma | R | R | R (kendi) | - | - | - | - |
| Gorev CRUD | R | R | R | C/U assigned | R (review) | - | R (read) |
| Dokuman Yukleme/Onay | R | R | R | U own | R | - | R |
| Dokuman Versiyon Onayi | R | R | R | - | R | - | (Read) |
| KPI Tanimi | R | R | U (proposal) | - | - | R | R (read) |
| KPI Veri Girisi | R | R | C | C assigned | - | R | R (read) |
| Raporlama Dashboardlari | R | R | R | R | R | R | R |
| Audit Log Erişimi | R | R | - | - | - | - | R |
| Sistem Ayarlari | R | - | - | - | - | - | - |

R=Read/Write, C=Create, U=Update, "-"=Yetki yok.

### 4.4 Is Akislari ve Yasam Donguleri

#### 4.4.1 Gorev Yasam Dongusu
```
draft -> planned -> in_progress -> (blocked | on_hold | completed | cancelled)
blocked -> in_progress | on_hold
on_hold -> planned | in_progress | cancelled
completed -> reopened (opsiyonel) -> in_progress
```
- Draft: PM veya ekip tarafindan olusturulur, planlanma oncesi.
- Planned: Takvim ve kaynak atamasi tamamlandi.
- In Progress: Calisma suruyor.
- Blocked: Engel raporlandi (sebep ve bloklayan bagimlilik).
- On Hold: Yonetsel sebeple durduruldu.
- Completed: Teslim edildi, kabul metni eklendi.
- Cancelled: Gerek kalmadi.
- Otomatik kural: planned durumunda olup planlanan baslangic tarihini 24 saat gecmis gorevler otomatis uyarilir. 48 saat gecerse PMO’ya eskale edilir.

#### 4.4.2 Dokuman Yasam Dongusu
```
draft -> in_review -> approved -> published -> archived
```
- Draft: Oluşturma/duzenleme.
- In Review: En az bir reviewer atanir; iki onay gereklidir (PM + Dokuman Yoneticisi).
- Approved: Onaycilar tamamladi, yayin hazir.
- Published: Son kullanicilar tarafindan gorulebilir (gizlilik seviyesine gore).
- Archived: Surum gecerliligini yitirdiginde veya yeni versiyon aktif oldugunda.
- Otomatik sürümleme: Yeni yukleme ayni dosya icin minormajor artirir, metadata degisikligi patch artirir.
- Virus taramasi zorunlu; infected -> karantina, bildirim.

#### 4.4.3 KPI Yasam Dongusu
```
proposed -> under_review -> active -> monitoring -> (breached | retired)
breached -> under_review | active
```
- Proposed: Yeni KPI talebi (PM veya Analist).
- Under Review: Formul, hedef, veri kaynaklari dogrulaniyor.
- Active: Onaylandi, performans takibi basladi.
- Monitoring: Donemsel veri toplanip raporlanıyor.
- Breached: Kritik esik asildi; aksiyon zorunlu.
- Retired: Artik takip edilmiyor, arsive alinmis.

### 4.5 Otomatik Aksiyonlar
- **Gorev Gecikmesi**: Planlanan bitis >24s gecmis -> gorev sahibi + PM email; >72s -> PMO eskalasyon, gorev statusu auto set blocked.
- **KPI Sapmasi**: actual >= threshold_warning -> steward + PM bildirim; actual >= threshold_critical -> KPI status breached, otomatik corrective action gorevi olusturulur.
- **Dokuman Onay Gecikmesi**: in_review durumunda 48s icinde onay yoksa reviewer’lara hatirlatma; 72s -> PM’e eskalasyon.
- **Audit**: Tum kritik aksiyonlar (status degisimi, versiyon onayi, KPI degisimi) audit log’a kaydedilir ve haftalik raporda sunulur.

### 4.6 Fonksiyonel Gereksinimler
Gereksinimler modul bazinda numaralandirildi (FR-XX).

#### 4.6.1 Proje ve Portfoy (FR-1x)
- FR-10: PMO yeni proje olusturabilmeli, kodu otomatik jenerasyon (format PRJ-YYYY-NNN).
- FR-11: Proje sablonlari (metadata ve gorev sablonu) tanimlanabilmeli.
- FR-12: Portfoy gorunumu; status, risk endeksi, butce vs.
- FR-13: Proje kapatma; tum gorevler tamam/kapatilmis olmali, dokumanlar arsivlenmeli.
- FR-14: Proje icinde rol bazli bildirim tercihleri.

#### 4.6.2 Gorev Yonetimi (FR-2x)
- FR-20: Gorev CRUD, alt gorev iliskisi sinirsiz derinlik (uygulamada 5 seviye oneri).
- FR-21: Kanban ve Gantt verisi icin API (status, timeline).
- FR-22: Gorev bagimliliklarini ekleme/silme, lag degerini guncelleme.
- FR-23: Yerlesik surec akisi: onay zorunlu gorevler icin check list.
- FR-24: Gorev yorumlari ve dosya ekleme.
- FR-25: Gorev izleme (watchers).
- FR-26: Ilerleme yuzdesi, plan/gercek saat takibi.

#### 4.6.3 Dokuman Yonetimi (FR-3x)
- FR-30: Dokuman yukleme (max 150MB, desteklenen format listesi).
- FR-31: Surum olusturma, semantik versiyon numarasi otomatik artirimi.
- FR-32: Onay zinciri konfigurasyonu (minimum iki onay).
- FR-33: Dokuman ve gorev baglama.
- FR-34: Dokuman arama (title, tag, type, full-text metadata).
- FR-35: Dokuman indirme, once yetki kontrolu.
- FR-36: Virus taramasi (clamscan veya servis).
- FR-37: Gizlilik seviyesine gore maskeleme (restricted => sadece yetkili gorebilir).

#### 4.6.4 KPI ve Analitik (FR-4x)
- FR-40: KPI sozlugu CRUD, formuller icin once syntax validasyonu.
- FR-41: KPI baglanti matrisi (hangi proje/gorev etkiliyor).
- FR-42: KPI veri girisi (manuel form) + dis kaynak gonderimi (API ingest).
- FR-43: KPI donemsel rapor (trend, hedef/guncel, sapma).
- FR-44: KPI sapma aksiyon gorevi olusturma.
- FR-45: KPI ihrac API (CSV, XLSX).
- FR-46: KPI dashboard konfigurasyonu (widget, filtre).

#### 4.6.5 Bildirim ve Is Akisi (FR-5x)
- FR-50: E-posta bildirim servisi (SMTP).
- FR-51: Opsiyonel Slack/Teams webhook bildirimi _(roadmap; backendde henüz yok)_.
- FR-52: Esnek kural motoru (json kural seti, cron).
- FR-53: Eski gorev/dokuman surumlerine geri donus icin onayli is akisi.

#### 4.6.6 Yonetim ve Audit (FR-6x)
- FR-60: Rol bazli erisim kontrolu (policy tabanli).
- FR-61: Audit log arama ve filtreleme.
- FR-62: Sistem ayar paneli (mail sunucusu, S3, virus taramasi vb).
- FR-63: Konfig backup/restore.
- FR-64: API anahtari olusturma (servis hesabi).

### 4.7 Kullanım Senaryolari
1. **Proje baslatma**: PMO sablon secer, proje yaratir, PM atar, baslangic gorev seti olusur.
2. **Gorev yurutme**: PM gorev planlar, ekip uyeleri ilerleme raporlar, gecikmede otomatik eskalasyon.
3. **Dokuman yayinlama**: Dokuman Yoneticisi versiyon yukler, onaycilar inceler, yayinlanir.
4. **KPI performans izleme**: KPI Analisti veri toplar, sapma olursa corrective action gorevi acilir.
5. **Denetim**: Denetci audit loglari ve KPI raporlarini inceler, ciktisi PDF olarak indirir.

### 4.8 API Endpoint Taslagi
| Modul | Method | Path | Aciklama | Yetki |
| --- | --- | --- | --- | --- |
| Auth | POST | /api/v1/auth/login | Giris | Tum |
| Auth | POST | /api/v1/auth/refresh | Token yenile | Tum |
| Kullanici | GET | /api/v1/users | Kullanici listesi | SysAdmin |
| Proje | POST | /api/v1/projects | Yeni proje | PMO |
| Proje | GET | /api/v1/projects | Filtrelenmis liste | Yetkili |
| Proje | GET | /api/v1/projects/{id} | Detay | Yetkili |
| Proje | PATCH | /api/v1/projects/{id} | Guncelleme | PMO/PM |
| Proje | POST | /api/v1/projects/{id}/close | Kapatma | PMO |
| Gorev | POST | /api/v1/projects/{id}/tasks | Gorev olustur | PM/PMO |
| Gorev | GET | /api/v1/projects/{id}/tasks | Liste | Yetkili |
| Gorev | PATCH | /api/v1/tasks/{id} | Durum/icerik guncelle | Yetkili |
| Gorev | POST | /api/v1/tasks/{id}/comments | Yorum ekle | Proje uyeleri |
| Gorev | POST | /api/v1/tasks/{id}/dependencies | Bagimlilik ekle | PM |
| Dokuman | POST | /api/v1/projects/{id}/documents | Dokuman yukle | Dokuman Yonetici/PM |
| Dokuman | GET | /api/v1/documents/{id} | Metadata | Yetkili |
| Dokuman | GET | /api/v1/documents/{id}/download | Dosya | Yetkili |
| Dokuman | POST | /api/v1/documents/{id}/versions | Yeni versiyon | Dokuman Yonetici |
| Dokuman | POST | /api/v1/document-versions/{id}/approve | Onay | Onayci |
| KPI | POST | /api/v1/kpis | KPI olustur | KPI Analisti |
| KPI | GET | /api/v1/kpis | Liste | Yetkili |
| KPI | POST | /api/v1/kpis/{id}/values | Veri girisi | Yetkili |
| KPI | GET | /api/v1/kpis/{id}/trend | Trend raporu | Yetkili |
| KPI | POST | /api/v1/kpis/{id}/breach-actions | Duzeltici gorev | Sistem/Analist |
| Rapor | GET | /api/v1/reports/portfolio | Portfoy ozet | PMO |
| Rapor | GET | /api/v1/audit/export | Audit log export (json/csv) | Denetci |
| Ayarlar | GET | /api/v1/settings | Konfigurasyon | SysAdmin |
| Ayarlar | PATCH | /api/v1/settings | Guncelle | SysAdmin |

Endpointler OpenAPI 3.1 spesifikasyonu ile belgelenecek, JSON:API uyumlu response formatlari kullanilacak.

### 4.9 Veri Saklama ve Uyumluluk
- **Dokumanlar**: Varsayilan saklama 5 yil, legal_hold flag aktif ise silinmez.
- **Audit Log**: 10 yil saklama, sadece append.
- **Kisisel Veri**: Minimum alan, gerekirse maskeleme (örn. TC numarasi tutulmaz, unvan/isim).
- **Silme**: Soft delete + 30 gunluk karantina, ardindan nihai silme.
- **Yedekleme**: Gunde bir tam, saatlik artan (PostgreSQL WAL + S3 versiyonlama).

### 4.10 Performans ve Diger Fonksiyonel Olmayan Gereksinimler
- **Kapasite**: 300 es zamanli oturum; ortalama 50 istek/s; p95 < 300ms (okuma), p95 < 500ms (yazma).
- **Olceklenebilirlik**: Kubernetes uzerinde yatay auto-scaling, 3 pod min, 6 pod max.
- **Guvenlik**: OWASP Top 10, rate limit (auth 5/min), brute force koruma, parolalar Argon2id ile hash.
- **Gozlemlenebilirlik**: OpenTelemetry ile trace, Prometheus metrikleri, ELK log.
- **Uptime**: MVP icin %99, sonraki faz %99.5.
- **RPO/RTO**: 4 saat / 8 saat.

### 4.11 Veri Kalitesi ve Gecis
- Master data (kullanicilar, departmanlar) CSV import veya manuel.
- Legacy sistem yoksa seed veriler: demo proje, gorev sablonlari, KPI ornekleri.
- Veri dogrulama: formuller regexp, numeric limitler.

## 5. Mimari ve Teknoloji Kararlari
- **Dil ve runtime**: Node.js 20 LTS, TypeScript 5.x, strict mode.
- **Framework**: Express 5 + Zod (validation) + awilix (dependency injection).
- **ORM**: Prisma (PostgreSQL 15), TimescaleDB extension.
- **Cache**: Redis 7 (session, rate limit, queue).
- **Queue**: BullMQ (Redis tabanli) gecikmeli isler icin.
- **Storage**: S3 (AWS), gelistirme icin MinIO.
- **Virus tarama**: ClamAV container.
- **Testing**: Jest, Supertest, Testcontainers, Pact (contract).
- **Dokumantasyon**: OpenAPI + Stoplight/Redoc, ADR dosyalari.

## 6. Veri Modeli Taslaklari
Ana tablolar:
```
projects, project_members, tasks, task_dependencies,
documents, document_versions, document_links,
kpi_definitions, kpi_series,
notifications, comments, audit_log,
users, roles, role_permissions, user_roles,
settings, api_keys, webhook_subscriptions
```
Timescale hypertable: `kpi_series`.
Full-text index: `documents(title, tags, metadata)`.
Partitioning: `audit_log` yila gore.

## 7. Gelistirme Sureci ve Kalite
- Kod standardi: ESLint (airbnb-base + custom), Prettier, commitlint.
- Branch stratejisi: trunk-based + feature branches, PR review zorunlu (2 onay).
- CI: Lint, unit test, integration test, security scan (npm audit, snyk).
- QA: Haftalik smoke test, Postman collection, playback e2e (Playwright API).
- Dokumantasyon: README, architecture decision record (ADR), runbook.

## 8. Docker ve Kubernetes Stratejisi
- Docker multi-stage (builder -> runtime). Runtime imaji distroless veya node:20-alpine.
- Config: 12-Factor, dotenv sadece gelistirme, prod icin K8s Secret + Vault.
- Kubernetes: Helm chart (deployment, service, HPA, ingress, configmap, secret).
- Stateful servis: Managed (RDS, Elasticache) veya ayrik cluster (helm).
- CI/CD: GitHub Actions pipeline (build/test -> image push -> helm deploy). Blue/green release (argo-rollouts opsiyonel).
- Monitoring: Prometheus/Grafana, Loki, Alertmanager (Slack/Teams). Health endpoints `/healthz`, `/readyz`.

## 9. Entegrasyon Stratejisi
- **MVP**: SMTP (mail bildirim), S3 (dosya depolama), ClamAV; Slack webhook'u opsiyonel, Teams entegrasyonu roadmap.
- **Opsiyonel**: Jira REST (gorev import), SAP/Logo (KPI veri cekme), PowerBI (dataset push), KEP servis saglayicilari, e-imza dogrulama.
- Entegrasyonlar moduler connector mimarisiyle yazilacak; queue uzerinden idempotent calisma.

## 10. 8 Haftalik Teslimat Plani
| Hafta | Odak | Cikti |
| --- | --- | --- |
| 1 | Proje altyapisi, repo setup, temel CI | Monorepo, lint/test pipeline, temel Express iskeleti |
| 2 | Auth + RBAC | User, role, token, sifre politikasi, audit temel |
| 3 | Proje ve gorev modulu | Proje CRUD, gorev CRUD, bagimlilik altyapisi |
| 4 | Gorev yorumlari, bildirim servisleri | Yorum API, SMTP servis, gecikme cron |
| 5 | Dokuman modulu | S3 upload, versiyonlama, virus tarama, onay akisi |
| 6 | KPI modulu | KPI sozlugu, veri girisi, trend raporu, sapma aksiyon |
| 7 | Raporlama ve dashboard API, audit export | Portfoy raporu, KPI raporu, audit log API |
| 8 | Hardening, performans testi, docker/k8s manifestleri | Load test raporu, helm chart, runbook, MVP demo |

Haftalik iteration sonunda review ve dokumantasyon guncellemesi yapilacak.

## 11. Otomatik Aksiyonlar icin Cron ve Kuyruk Tasarimi

Otomatik kural setleri BullMQ tabanli kuyruklar ve Node.js cron scheduler ile hayata gecirilecektir. Zamanlayici ve isleyici gorevler `automations-service` adli bagimsiz worker deployment'i icinde calisir.

### 11.1 Bilesenler
- **Scheduler Worker:** Cron tabanli tetikleyiciler olusturur, ilgili kuyruga job ekler.
- **Processor Worker:** Kuyruktan gelen job'lari isleyerek veritabani gunceller, bildirim tetikler.
- **Kuyruklar ve eszamanlilik**
  - `task-monitoring` - concurrency: 10
  - `kpi-monitoring` - concurrency: 5
  - `document-approval` - concurrency: 5
  - `notification-dispatch` - concurrency: 20
- **Tekrar politikasi:** 3 deneme, exponential backoff (2^n dakika, maks. 60 dk), sonrasinda alert.
- **Timeoutlar:** Standart 30 sn; bildirim gorevleri 10 sn; agir DB islemleri 20 sn.
- **Idempotentlik:** Job payload'u `jobKey` (kural + entityId + period) ile olusturulur, isleme baslamadan once mevcut durum kontrol edilir.

### 11.2 Kurallar ve Cron Programlari
| Kural | Cron (UTC) | Kuyruk | Payload | Islem Adimlari |
| --- | --- | --- | --- | --- |
| Gorev planlanan baslangici gecmis | `*/30 * * * *` | `task-monitoring` | `{ taskId }` | 1) `planned_start < now-24h` olan `planned` gorevleri tara. 2) Owner + PM'e mail/webhook bildirimi gonder. 3) Gorev `blocked` degilse statusu `blocked` yap ve audit log kaydet. |
| Gorev planlanan bitisi gecmis | `0 * * * *` | `task-monitoring` | `{ taskId }` | 1) `planned`/`in_progress` gorevlerde `planned_end < now`. 2) 24h gecikmede uyari, 72h gecikmede PMO eskalasyonu ve status `blocked`. |
| KPI esik kontrolu | `15 */6 * * *` | `kpi-monitoring` | `{ kpiId, period }` | 1) `active` KPI'larin son `kpi_series` kaydini oku. 2) Esik asildiysa steward + PM'e bildirim gonder. 3) Kritik asimda duzeltici gorev olustur. |
| Dokuman onay gecikmesi | `*/15 * * * *` | `document-approval` | `{ documentVersionId }` | 1) `in_review` durumunda 48 saati gecmis versiyonlari bul. 2) Reviewer'lara hatirlatma maili. 3) 72 saati gecmis ise proje yoneticisine eskalasyon. |
| Haftalik audit raporu | `0 18 * * FRI` | `notification-dispatch` | `{ reportType: "weekly-audit" }` | 1) Son 7 gunluk audit loglarini derle. 2) PDF/CSV rapor uret. 3) Denetci + PMO'ya mail ile gonder. |

Cron ifadeleri varsayilan olarak UTC'dir; ortam degiskenleri ile surum bazinda guncellenebilir. Kayitlar 500'luk paketler halinde islenir, pagination ile devam eder.

### 11.3 Konfigurasyon ve Gozlemlenebilirlik
- Cron frekanslari environment degiskenleri (`AUTOMATION_TASK_CRON` vb.) veya `settings` tablosu ile override edilebilir.
- Kuyruk metrikleri Prometheus exporter uzerinden `queue_active_jobs`, `queue_failed_jobs`, `queue_latency_seconds` metrikleriyle izlenir.
- Basarisiz job'lar Alertmanager araciligiyla SysAdmin'e bildirilir; kritik durumlarda PagerDuty/Teams entegrasyonu acilabilir.
- Worker deployment'i en az 2 replica olarak calisir; Redis icin sentinel/cluster konfigurasyonu onerilir.
- Job calisma kayitlari `automation_job_log` tablosunda saklanir (id, jobKey, status, started_at, finished_at, error).

### 11.4 PoC (Proof of Concept) Plani
1. Lokal ortamda BullMQ + Redis ile `task-monitoring` kuyruğunu baslat.
2. `node-cron` kullanarak her dakika tetiklenen scheduler ile gecikmis iki gorev icin job olustur.
3. Job calistiginda gorev statusu degisiyor mu ve MailHog uzerinden bildirim ulasiyor mu dogrula.
4. Ayni job iki kez calistirildiginda ikinci calismada degisiklik olmadigini (idempotentlik) test et.
5. Sonuclari ve gozlenen riskleri ADR dokumani olarak kaydet; PoC onaylanmadan prod ortamda otomasyon aktif edilmeyecek.

## 12. Sonraki Adimlar ve Oneriler
1. Gereksinim workshop’u simule edilerek dummy veri setleri olusturulacak.
2. KPI formulleri icin hafif parser ve test ornekleri hazirlanacak.
3. Virus tarama ve S3 icin ortam degiskenleri (development/staging/prod) tanimlanacak.
4. Teknik borc ve bekleyen entegrasyonlar backlog’da ADR ile belgelemeli.

## Ek A: API Response ve Hata Konvansiyonlari
- Tum JSON cevaplar `data`, `meta`, `errors` yapisina sahiptir.
- Basarili cevap ornegi:
```json
{
  "data": {
    "type": "task",
    "id": "task_123",
    "attributes": {
      "title": "Analiz Calismasi",
      "status": "in_progress"
    },
    "relationships": {
      "project": { "type": "project", "id": "proj_001" }
    }
  },
  "meta": { "requestId": "c0a8012a-..." }
}
```
- Hata cevaplari HTTP status'u ile birlikte hata kodu, baslik ve detay icerir:
```json
{
  "errors": [
    {
      "code": "TASK_NOT_FOUND",
      "title": "Task not found",
      "detail": "Task with id task_999 does not exist",
      "meta": { "entity": "task", "id": "task_999" }
    }
  ]
}
```
- Standart hata kodlari: `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `VALIDATION_FAILED`, `ACCESS_DENIED`, `TASK_NOT_FOUND`, `PROJECT_NOT_FOUND`, `DOCUMENT_APPROVAL_REQUIRED`, `KPI_THRESHOLD_BREACHED`, `RATE_LIMIT_EXCEEDED`.
- Rate limit ihlalinde 429 + `Retry-After` header'i gonderilir; tum cevaplarda `X-Request-ID` bulunur.

## Ek B: Terimler Sozlugu
- **PoC (Proof of Concept):** Tasarimin uygulanabilirligini test etmek icin hazirlanan kucuk kapsamli ornek uygulama.
- **BullMQ:** Redis tabanli gorev kuyrugu kutuphanesi.
- **Cron:** Belirli araliklarla gorev tetiklemeye yarayan zamanlama formati.
- **ADR (Architecture Decision Record):** Mimari kararlarin kaydedildigi dokuman.
- **SLA / RPO / RTO:** Hizmet seviyesi ve felaket kurtarma hedefleri.
- **Hypertable:** TimescaleDB’de zaman serisi veriler icin kullanilan partisyonlu tablo yapisi.

---

Bu dokuman ilerledikce guncellenmeli; gelistirme tamamlandikca gerceklesmeler ve sapmalar eklenmelidir. Varsayimlar degistiginde ilgili bolumler hizla guncellenmelidir.
