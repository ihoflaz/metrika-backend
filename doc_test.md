
> metrika-backend@1.0.0 test
> cross-env NODE_ENV=test jest --runInBand --forceExit --detectOpenHandles tests/documents/documents.e2e.test.ts

Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "metrika", schema "test_5d683fc7b4ea4c1ca44758fe108bf82b" at "localhost:5432"

21 migrations found in prisma/migrations

Applying migration `20251031010040_init_auth_rbac`
Applying migration `20251031131405_project_task_module`
Applying migration `20251031170907_add_task_dependency_type`
Applying migration `20251031182639_week4_week5_features`
Applying migration `20251031222708_add_project_member`
Applying migration `20251031230625_add_kpi_module`
Applying migration `20251101183520_add_kanban_position_to_tasks`
Applying migration `20251101183530_add_kanban_position_to_tasks`
Applying migration `20251101210529_add_api_keys`
Applying migration `20251102020354_add_kanban_position`
Applying migration `20251102020426_add_kanban_indexes`
Applying migration `20251102021508_add_unsubscribe_email_log`
Applying migration `20251102022339_add_project_code_sequence`
Applying migration `20251102024824_add_document_task_linking`
Applying migration `20251102184013_add_task_code_and_kpi_links`
Applying migration `20251102184117_add_task_code_and_kpi_links`
Applying migration `20251102191844_add_fulltext_search_indexes`
Applying migration `20251102210000_add_settings_preferences`
Applying migration `20251102221131_add_kanban_position_seeding`
Applying migration `20251103090000_implement_fulltext_search`
Applying migration `20251108205000_add_notifications_webhooks`

The following migration(s) have been applied:

migrations/
  ÔööÔöÇ 20251031010040_init_auth_rbac/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251031131405_project_task_module/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251031170907_add_task_dependency_type/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251031182639_week4_week5_features/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251031222708_add_project_member/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251031230625_add_kpi_module/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251101183520_add_kanban_position_to_tasks/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251101183530_add_kanban_position_to_tasks/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251101210529_add_api_keys/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102020354_add_kanban_position/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102020426_add_kanban_indexes/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102021508_add_unsubscribe_email_log/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102022339_add_project_code_sequence/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102024824_add_document_task_linking/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102184013_add_task_code_and_kpi_links/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102184117_add_task_code_and_kpi_links/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102191844_add_fulltext_search_indexes/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102210000_add_settings_preferences/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251102221131_add_kanban_position_seeding/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251103090000_implement_fulltext_search/
    ÔööÔöÇ migration.sql
  ÔööÔöÇ 20251108205000_add_notifications_webhooks/
    ÔööÔöÇ migration.sql
      
All migrations have been successfully applied.
{"level":30,"time":1764448460806,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templates":["task-delayed","kpi-breach","welcome","document-approval-reminder","task-assigned","task-completed"],"msg":"Warming email template cache..."}
{"level":20,"time":1764448460812,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-delayed","cacheMisses":1,"msg":"Template cache miss"}
{"level":20,"time":1764448460813,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"kpi-breach","cacheMisses":2,"msg":"Template cache miss"}
{"level":20,"time":1764448460814,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"welcome","cacheMisses":3,"msg":"Template cache miss"}
{"level":20,"time":1764448460814,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"document-approval-reminder","cacheMisses":4,"msg":"Template cache miss"}
{"level":20,"time":1764448460815,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-assigned","cacheMisses":5,"msg":"Template cache miss"}
{"level":20,"time":1764448460815,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-completed","cacheMisses":6,"msg":"Template cache miss"}
{"level":30,"time":1764448465158,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-delayed","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"kpi-breach","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"welcome","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"document-approval-reminder","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-assigned","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","templateName":"task-completed","msg":"Email template loaded and cached"}
{"level":30,"time":1764448465159,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","total":6,"success":6,"msg":"Template cache warming completed"}
{"level":30,"time":1764448465466,"pid":52316,"hostname":"ihoflazpc","name":"QueueService","msg":"­şôĞ QueueService initialized with queues: task-automation, kpi-automation, document-automation, notification"}
{"level":30,"time":1764448465469,"pid":52316,"hostname":"ihoflazpc","name":"BullBoard","msg":"­şôè Bull Board initialized successfully"}
{"level":30,"time":1764448465469,"pid":52316,"hostname":"ihoflazpc","name":"BullBoard","msg":"   - Monitoring 4 queues"}
{"level":30,"time":1764448465469,"pid":52316,"hostname":"ihoflazpc","name":"BullBoard","msg":"   - Access UI at: /admin/queues"}
{"level":30,"time":1764448465469,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","msg":"­şôè Bull Board mounted at /admin/queues"}
{"level":20,"time":1764448465914,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","requestId":"9bccfd60-292b-4a3f-a133-8e8cba997e23","method":"POST","path":"/api/v1/auth/login","msg":"Handling incoming request"}
{"level":20,"time":1764448466072,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","requestId":"5ad1b678-1c7a-43f6-a91f-18c8c8aadf7b","method":"POST","path":"/api/v1/auth/login","msg":"Handling incoming request"}
{"level":20,"time":1764448466212,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","requestId":"e6ccc720-848d-4537-a0b7-25728131a628","method":"POST","path":"/api/v1/projects","msg":"Handling incoming request"}
{"level":50,"time":1764448466264,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","err":{"type":"PrismaClientKnownRequestError","message":"\nInvalid `this.prisma.project.create()` invocation in\nC:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\src\\modules\\projects\\project.service.ts:133:32\n\n  130 const code = await this.projectCodeService.generateCode();\n  131 const budgetPlanned = toDecimal(input.budgetPlanned);\n  132 \nÔåÆ 133 return this.prisma.project.create(\nThe column `Project.healthScore` does not exist in the current database.","stack":"PrismaClientKnownRequestError: \nInvalid `this.prisma.project.create()` invocation in\nC:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\src\\modules\\projects\\project.service.ts:133:32\n\n  130 const code = await this.projectCodeService.generateCode();\n  131 const budgetPlanned = toDecimal(input.budgetPlanned);\n  132 \nÔåÆ 133 return this.prisma.project.create(\nThe column `Project.healthScore` does not exist in the current database.\n    at ei.handleRequestError (C:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\node_modules\\@prisma\\client\\src\\runtime\\RequestHandler.ts:228:13)\n    at ei.handleAndLogRequestError (C:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\node_modules\\@prisma\\client\\src\\runtime\\RequestHandler.ts:174:12)\n    at ei.request (C:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\node_modules\\@prisma\\client\\src\\runtime\\RequestHandler.ts:143:12)\n    at async a (C:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\node_modules\\@prisma\\client\\src\\runtime\\getPrismaClient.ts:833:24)\n    at async create (C:\\Users\\hulus\\OneDrive\\Masa├╝st├╝\\Projeler\\Metrika\\metrika-backend\\src\\http\\controllers\\project\\projects.controller.ts:101:21)","code":"P2022","meta":{"modelName":"Project","column":"Project.healthScore"},"clientVersion":"6.18.0","name":"PrismaClientKnownRequestError"},"requestId":"e6ccc720-848d-4537-a0b7-25728131a628","msg":"Unhandled error encountered"}
{"level":30,"time":1764448466278,"pid":52316,"hostname":"ihoflazpc","name":"QueueService","msg":"­şøæ Closing all queues..."}
{"level":30,"time":1764448466289,"pid":52316,"hostname":"ihoflazpc","name":"QueueService","msg":"Ô£à All queues closed"}
{"level":30,"time":1764448466289,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","msg":"Shutting down approval queue workers"}
{"level":30,"time":1764448466297,"pid":52316,"hostname":"ihoflazpc","name":"metrika-backend","msg":"Approval queue workers shut down"}
