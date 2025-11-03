# 🎯 METRIKA - Enterprise Project Management Backend

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-22.x-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-5.1-lightgrey?logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-7.x-red?logo=redis)
![Prisma](https://img.shields.io/badge/Prisma-6.18-2D3748?logo=prisma)
![License](https://img.shields.io/badge/license-MIT-green)

**Contextual Project Management System with KPI-Driven Automation**

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [API Docs](#-api-documentation) • [Deployment](#-deployment)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the Application](#-running-the-application)
- [Testing](#-testing)
- [API Documentation](#-api-documentation)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [Automation & Workers](#-automation--workers)
- [Deployment](#-deployment)
- [Monitoring](#-monitoring)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**Metrika** is an enterprise-grade project management backend system built on academic research principles. It implements **Contextual Data Integrity**, **KPI-Driven Management**, and **Operational Memory** to provide comprehensive project oversight and automated decision support.

### What Makes Metrika Different?

- 🔄 **Automatic KPI Monitoring** - Detects threshold breaches and creates corrective tasks automatically
- 📊 **Contextual Data Integrity** - Every task, document, and change is tracked within project context
- ⚡ **Smart Automation** - BullMQ + Cron jobs handle task delays, approval reminders, and weekly reports
- 🔍 **Full-Text Search** - PostgreSQL tsvector with GIN indexes for blazing-fast search
- 📧 **Intelligent Notifications** - Queue-based email system with 7 customizable templates
- 🔐 **Enterprise Security** - JWT + RBAC + Argon2id + API Keys with scope management
- 📈 **Advanced Reporting** - Excel & PDF exports with professional styling

---

## ✨ Key Features

### 🏗️ Project Management
- ✅ **Automatic Project Codes** - PRJ-YYYY-NNNN format with thread-safe generation
- ✅ **Project Closure Workflow** - Validation checks + PDF closure report
- ✅ **Project Cloning** - Full or selective cloning with dependency preservation
- ✅ **Member Management** - Role-based access + allocation tracking
- ✅ **Full-Text Search** - Search across projects, tasks, and documents

### 📋 Task Management
- ✅ **Task Dependencies** - 4 types (FS, SS, FF, SF) with circular dependency prevention
- ✅ **Task Hierarchy** - Parent-child relationships with auto-completion
- ✅ **Bulk Operations** - Update/delete/assign multiple tasks in transactions
- ✅ **Kanban Board** - Drag-and-drop support with reordering
- ✅ **Task Comments & Watchers** - Threaded comments + notification subscriptions
- ✅ **Delay Detection** - Automatic detection of overdue tasks (cron every 30 min)

### 📄 Document Management
- ✅ **S3/MinIO Storage** - Scalable file storage with presigned URLs
- ✅ **Version Control** - Document versioning with version notes
- ✅ **Approval Workflow** - PENDING → APPROVED/REJECTED with reminders
- ✅ **Task Linking** - Many-to-many document-task relationships
- ✅ **Virus Scanning** - ClamAV integration ready
- ✅ **MIME Type Validation** - File extension whitelist

### 📊 KPI Management
- ✅ **KPI Types** - Task completion, schedule adherence, budget variance, quality score
- ✅ **Automatic Calculation** - Real-time KPI computation
- ✅ **Breach Detection** - Threshold monitoring with severity levels
- ✅ **Corrective Actions** - Auto-create tasks when KPIs breach thresholds
- ✅ **Trend Analysis** - Historical tracking with statistics
- ✅ **Cron Monitoring** - Automatic breach checks every 6 hours

### 🤖 Automation & Workers
- ✅ **BullMQ Queue System** - 4 queues with dedicated workers
- ✅ **4 Workers** - Task automation, KPI monitoring, document approval, notifications
- ✅ **4 Cron Jobs** - Task delay check (30 min), KPI breach (6 hr), document reminder (15 min), weekly audit (Mon 9am)
- ✅ **Email Queue** - Template-based emails with 7 pre-built templates
- ✅ **Graceful Shutdown** - Worker cleanup on SIGTERM/SIGINT

### 🔐 Security & Auth
- ✅ **JWT Authentication** - Access (15 min) + Refresh (7 days) tokens
- ✅ **RBAC** - 4 roles (SYSADMIN, PMO, PROJECT_MANAGER, TEAM_MEMBER) + 30 permissions
- ✅ **API Keys** - Secure key generation (SHA-256) with scopes
- ✅ **Password Policy** - Argon2id hashing + complexity requirements
- ✅ **Audit Logging** - All CRUD operations tracked

### 📈 Reporting & Export
- ✅ **Excel Export** - ExcelJS with conditional formatting + styling
- ✅ **PDF Export** - PDFKit with headers/footers
- ✅ **Audit Export** - CSV/JSON export of audit logs
- ✅ **Project Closure Report** - PDF summary with statistics

### ⚙️ System Management
- ✅ **System Settings** - Key-value store with cache + type safety
- ✅ **Feature Flags** - Enable/disable features dynamically
- ✅ **Notification Preferences** - User-level email preferences
- ✅ **Unsubscribe Mechanism** - Token-based email unsubscribe

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        API Gateway                           │
│                    (Express 5.1)                             │
└─────────────────┬───────────────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ Auth   │  │  RBAC    │  │  Error   │
│ Middleware │  Middleware │  Handler │
└────────┘  └──────────┘  └──────────┘
    │             │             │
    └─────────────┼─────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌──────────────────┐    ┌──────────────────┐
│   Controllers    │    │    Services      │
│  (HTTP Layer)    │───▶│ (Business Logic) │
└──────────────────┘    └────────┬─────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            ┌────────────┐ ┌──────────┐ ┌──────────┐
            │  Prisma    │ │  Redis   │ │  S3/     │
            │  (ORM)     │ │  (Cache) │ │  MinIO   │
            └─────┬──────┘ └──────────┘ └──────────┘
                  │
                  ▼
            ┌──────────────┐
            │  PostgreSQL  │
            │  Database    │
            └──────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Background Workers                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Task Worker  │  │  KPI Worker  │  │  Doc Worker  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────────────────────────┐   │
│  │ Email Worker │  │   Cron Schedulers (4 jobs)       │   │
│  └──────────────┘  └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Layered Architecture

1. **HTTP Layer** (`src/http/`)
   - Routes: Endpoint definitions
   - Controllers: Request handling + validation
   - Middleware: Auth, RBAC, error handling

2. **Business Logic Layer** (`src/modules/`)
   - Services: Core business logic
   - Domain models
   - Use case implementations

3. **Data Access Layer**
   - Prisma ORM
   - Database queries
   - Transaction management

4. **Infrastructure Layer**
   - Queue system (BullMQ)
   - Storage (S3/MinIO)
   - Cache (Redis)
   - Email (SMTP)

---

## 🛠️ Tech Stack

### Backend
- **Runtime:** Node.js 22.x
- **Language:** TypeScript 5.9
- **Framework:** Express 5.1
- **ORM:** Prisma 6.18

### Database
- **Primary:** PostgreSQL 16
- **Features:** UUID v7, tsvector, GIN indexes, JSON fields
- **Cache:** Redis 7.x

### Queue & Workers
- **Queue:** BullMQ 5.63
- **Scheduler:** node-cron 3.0
- **Workers:** 4 dedicated workers

### Storage & Files
- **Storage:** AWS S3 / MinIO
- **Virus Scan:** ClamAV (optional)

### Authentication & Security
- **Auth:** JWT (jsonwebtoken 9.0)
- **Password:** Argon2id
- **API Keys:** SHA-256 hashing

### Notifications
- **Email:** Nodemailer 6.10
- **Templates:** Handlebars 4.7

### Reports
- **Excel:** ExcelJS 4.4
- **PDF:** PDFKit 0.13

### Testing
- **Framework:** Jest 29.7
- **HTTP Testing:** Supertest 7.1
- **Containers:** Testcontainers 11.7

### DevOps
- **Containerization:** Docker
- **Orchestration:** Kubernetes
- **Packaging:** Helm Charts
- **Logging:** Pino + Winston

---

## 📦 Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 10.0.0
- **PostgreSQL** >= 16.0
- **Redis** >= 7.0
- **Docker** (optional, for containerized setup)

---

## 🚀 Installation

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/metrika-backend.git
cd metrika-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration (see [Configuration](#-configuration) section).

### 4. Setup Database

**Option A: Docker Compose (Recommended for Development)**

```bash
docker-compose up -d postgres redis minio
```

**Option B: Local Installation**

Install PostgreSQL 16 and Redis 7 locally, then create database:

```sql
CREATE DATABASE metrika;
CREATE USER metrika WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE metrika TO metrika;
```

### 5. Run Migrations

```bash
npm run prisma:migrate
```

### 6. Seed Database (Optional)

```bash
npm run db:seed
```

This creates:
- Admin user (admin@metrika.com / Admin123!)
- Sample roles and permissions
- Test projects and tasks

---

## ⚙️ Configuration

### Environment Variables

Create `.env` file from `.env.example`:

```bash
# Application
APP_HOST=0.0.0.0
APP_PORT=3000
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Authentication
AUTH_ACCESS_TOKEN_SECRET=your-secret-key-change-me
AUTH_REFRESH_TOKEN_SECRET=your-refresh-secret-change-me
AUTH_ACCESS_TOKEN_TTL=900         # 15 minutes
AUTH_REFRESH_TOKEN_TTL=604800     # 7 days

# Database
DATABASE_URL=postgresql://metrika:metrika_pass@localhost:5432/metrika

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# SMTP (Email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@metrika.com

# Storage (S3/MinIO)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=metrika-documents

# ClamAV (Optional)
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# Alerts (Optional)
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_EMAIL_ENABLED=false
ALERT_EMAIL_RECIPIENTS=admin@metrika.com
```

### Important Notes

⚠️ **Security:** Change `AUTH_ACCESS_TOKEN_SECRET` and `AUTH_REFRESH_TOKEN_SECRET` in production!

⚠️ **SMTP:** For Gmail, use [App Passwords](https://support.google.com/accounts/answer/185833)

⚠️ **Storage:** MinIO is S3-compatible. For AWS S3, change `STORAGE_ENDPOINT` to AWS endpoint.

---

## 🏃 Running the Application

### Development Mode

```bash
npm run dev
```

Server starts at `http://localhost:3000`

### Production Mode

```bash
# Build
npm run build

# Start
npm start
```

### With Docker Compose

```bash
# Start all services (app + postgres + redis + minio)
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-03T10:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "workers": "running"
  }
}
```

---

## 🧪 Testing

### Run All Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
npm test auth.e2e.test
npm test tasks.e2e.test
npm test kpi-breach.e2e.test
```

### Run with Coverage

```bash
npm test -- --coverage
```

### E2E Tests

```bash
npm test -- tests/auth/
npm test -- tests/projects/
npm test -- tests/tasks/
```

### Test Statistics

- **Total Tests:** 325+ test cases
- **E2E Tests:** 27 files
- **Unit Tests:** 3 files
- **Coverage:** ~70-75%

---

## 📚 API Documentation

### Base URL

```
http://localhost:3000/api/v1
```

### Authentication

All endpoints (except public ones) require JWT token:

```bash
# Login
POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}

# Response
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": { ... }
}

# Use token in subsequent requests
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3000/api/v1/projects
```

### Core Endpoints

#### **Authentication**
```
POST   /api/v1/auth/login          # Login
POST   /api/v1/auth/logout         # Logout
POST   /api/v1/auth/refresh        # Refresh token
POST   /api/v1/auth/change-password # Change password
```

#### **Users**
```
GET    /api/v1/users               # List users
POST   /api/v1/users               # Create user (SYSADMIN)
GET    /api/v1/users/:id           # Get user
PUT    /api/v1/users/:id           # Update user
DELETE /api/v1/users/:id           # Delete user
```

#### **Projects**
```
GET    /api/v1/projects            # List projects
POST   /api/v1/projects            # Create project
GET    /api/v1/projects/:id        # Get project
PUT    /api/v1/projects/:id        # Update project
DELETE /api/v1/projects/:id        # Delete project
POST   /api/v1/projects/:id/close  # Close project
POST   /api/v1/projects/:id/clone  # Clone project
GET    /api/v1/projects/search     # Search projects
```

#### **Tasks**
```
GET    /api/v1/tasks               # List tasks
POST   /api/v1/tasks               # Create task
GET    /api/v1/tasks/:id           # Get task
PUT    /api/v1/tasks/:id           # Update task
DELETE /api/v1/tasks/:id           # Delete task
POST   /api/v1/tasks/bulk/update   # Bulk update tasks
POST   /api/v1/tasks/bulk/delete   # Bulk delete tasks
GET    /api/v1/tasks/search        # Search tasks
```

#### **Documents**
```
GET    /api/v1/documents           # List documents
POST   /api/v1/documents           # Upload document
GET    /api/v1/documents/:id/download # Download document
POST   /api/v1/documents/:id/approve  # Approve document
```

#### **KPIs**
```
GET    /api/v1/kpis                # List KPIs
POST   /api/v1/kpis                # Create KPI
GET    /api/v1/kpis/:id/trends     # Get KPI trends
GET    /api/v1/kpis/breaches       # List breaches
```

### Full API Documentation

For complete API documentation with request/response examples, see:
- Swagger UI: `http://localhost:3000/api-docs` (after running `npm run dev`)
- Postman Collection: `docs/postman-collection.json`

---

## 📁 Project Structure

```
metrika-backend/
├── src/
│   ├── http/                      # HTTP layer
│   │   ├── controllers/          # Request handlers
│   │   ├── middleware/           # Auth, RBAC, error handling
│   │   └── routes/               # Route definitions
│   ├── modules/                   # Business logic
│   │   ├── auth/                 # Authentication
│   │   ├── users/                # User management
│   │   ├── projects/             # Project management
│   │   ├── tasks/                # Task management
│   │   ├── documents/            # Document management
│   │   ├── kpi/                  # KPI management
│   │   ├── automation/           # Workers & cron jobs
│   │   ├── notifications/        # Email notifications
│   │   ├── reports/              # Excel/PDF exports
│   │   ├── settings/             # System settings
│   │   └── audit/                # Audit logging
│   ├── config/                    # Configuration files
│   ├── lib/                       # Utilities & helpers
│   ├── db/                        # Database connection
│   ├── types/                     # TypeScript types
│   ├── server.ts                  # Server entry point
│   └── index.ts                   # Application bootstrap
├── tests/                         # Test suites
│   ├── auth/                     # Auth tests
│   ├── projects/                 # Project tests
│   ├── tasks/                    # Task tests
│   ├── kpi/                      # KPI tests
│   └── utils/                    # Test utilities
├── prisma/                        # Database
│   ├── schema.prisma             # Database schema
│   ├── migrations/               # Migration files
│   └── seed.ts                   # Database seeding
├── templates/                     # Email templates
│   └── email/                    # Handlebars templates
├── k8s/                          # Kubernetes manifests
├── helm/                         # Helm charts
├── docker-compose.yml            # Docker Compose config
├── Dockerfile                    # Docker image
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
└── jest.config.ts                # Jest config
```

---

## 🗄️ Database Schema

### Core Tables

**Users & Auth**
- `users` - User accounts
- `api_keys` - API key management
- `notification_preferences` - Email preferences

**Projects**
- `projects` - Project master data
- `project_members` - Project team members
- `project_code_counters` - Auto code generation

**Tasks**
- `tasks` - Task records
- `task_dependencies` - Task relationships
- `task_comments` - Task comments
- `task_watchers` - Task subscribers

**Documents**
- `documents` - Document metadata
- `document_versions` - Version history
- `document_task_links` - Task associations
- `document_approval_requests` - Approval workflow

**KPIs**
- `kpis` - KPI definitions
- `kpi_values` - Historical values

**System**
- `audit_logs` - Change tracking
- `system_settings` - Configuration

### Key Features

- **UUID v7 Primary Keys** - Time-sortable UUIDs
- **Full-Text Search** - `tsvector` + GIN indexes
- **Soft Delete** - `deletedAt` timestamp
- **Audit Trail** - Automatic change logging
- **JSON Fields** - Flexible metadata storage

### ER Diagram

```
┌─────────┐       ┌──────────┐       ┌─────────┐
│  User   │◄─────►│ Project  │◄─────►│  Task   │
└─────────┘       └──────────┘       └─────────┘
     │                  │                   │
     │                  │                   │
     ▼                  ▼                   ▼
┌─────────┐       ┌──────────┐       ┌─────────┐
│ API Key │       │   KPI    │       │Document │
└─────────┘       └──────────┘       └─────────┘
                       │                   │
                       │                   │
                       ▼                   ▼
                  ┌──────────┐       ┌─────────┐
                  │KPI Value │       │ Version │
                  └──────────┘       └─────────┘
```

---

## 🤖 Automation & Workers

### BullMQ Queue System

**4 Queues:**
1. `task-automation` - Task delay detection, reminders
2. `kpi-automation` - KPI breach monitoring
3. `document-automation` - Approval reminders
4. `notification` - Email sending

### Workers

**1. Task Automation Worker**
- Checks overdue tasks every 30 minutes
- Sends task reminders
- Auto-completes parent tasks

**2. KPI Monitoring Worker**
- Monitors KPI thresholds every 6 hours
- Creates corrective action tasks
- Sends breach alerts

**3. Document Approval Worker**
- Checks pending approvals every 15 minutes
- Sends reminder emails after 48 hours

**4. Notification Worker**
- Processes email queue
- Renders Handlebars templates
- Handles bulk emails

### Cron Jobs

```typescript
// Task delay check - Every 30 minutes
'*/30 * * * *' → taskDelayCheckCron()

// KPI breach check - Every 6 hours
'0 */6 * * *' → kpiBreachCheckCron()

// Document reminder - Every 15 minutes
'*/15 * * * *' → documentReminderCron()

// Weekly audit - Every Monday 9am
'0 9 * * 1' → weeklyAuditCron()
```

### Queue Monitoring

Access Bull Board dashboard:
```
http://localhost:3000/admin/queues
```

Features:
- Real-time queue metrics
- Job details
- Retry failed jobs
- View logs

---

## 🚢 Deployment

### Docker

**Build Image:**
```bash
docker build -t metrika-backend:latest .
```

**Run Container:**
```bash
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_HOST=redis \
  --name metrika-backend \
  metrika-backend:latest
```

### Kubernetes

**Apply Manifests:**
```bash
kubectl apply -f k8s/
```

**Check Status:**
```bash
kubectl get pods -n metrika
kubectl logs -f deployment/metrika-backend -n metrika
```

### Helm

**Install Chart:**
```bash
helm install metrika ./helm/metrika-backend \
  --namespace metrika \
  --create-namespace \
  --values values.production.yaml
```

**Upgrade:**
```bash
helm upgrade metrika ./helm/metrika-backend \
  --namespace metrika \
  --values values.production.yaml
```

### Environment-Specific Configs

- `values.dev.yaml` - Development
- `values.staging.yaml` - Staging
- `values.production.yaml` - Production

---

## 📊 Monitoring

### Logs

**Application Logs:**
```bash
# Docker
docker logs -f metrika-backend

# Kubernetes
kubectl logs -f deployment/metrika-backend
```

**Log Levels:**
- `error` - Errors only
- `warn` - Warnings + errors
- `info` - Info + warnings + errors
- `debug` - All logs (development)

### Metrics

**Health Endpoint:**
```bash
curl http://localhost:3000/api/v1/health
```

**Queue Metrics:**
```bash
curl http://localhost:3000/api/v1/queues/metrics
```

**Cron Status:**
```bash
curl http://localhost:3000/api/v1/queues/cron-status
```

### Audit Logs

All CRUD operations are automatically logged to `audit_logs` table:

```typescript
{
  actorType: 'USER',
  actorId: 'user-uuid',
  eventCode: 'PROJECT_CREATED',
  description: 'Created project PRJ-2025-0001',
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
  metadata: { projectId: '...', ... },
  createdAt: '2025-11-03T10:00:00Z'
}
```

**Export Audit Logs:**
```bash
GET /api/v1/audit/export?format=csv&startDate=2025-01-01&endDate=2025-12-31
GET /api/v1/audit/export?format=json
```

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run linter (`npm run lint`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Style

- **TypeScript** - Strict mode enabled
- **ESLint** - Airbnb config + TypeScript rules
- **Prettier** - Code formatting
- **Naming** - camelCase for variables, PascalCase for classes

### Testing Requirements

- All new features must have tests
- Maintain >75% code coverage
- E2E tests for API endpoints
- Unit tests for business logic

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add KPI dashboard widgets
fix: resolve circular dependency in tasks
docs: update API documentation
test: add E2E tests for project cloning
chore: upgrade dependencies
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👥 Authors

- **Metrika Team** - [GitHub](https://github.com/yourusername)

---

## 📞 Support

- **Documentation:** [Wiki](https://github.com/yourusername/metrika-backend/wiki)
- **Issues:** [GitHub Issues](https://github.com/yourusername/metrika-backend/issues)
- **Email:** support@metrika.com

---

## 🙏 Acknowledgments

- Built on research from METRIKA_AKADEMIK_MAKALE_FINAL.md
- Inspired by enterprise project management best practices
- Community contributors and testers

---

<div align="center">

**Made with ❤️ by Metrika Team**

[⬆ Back to Top](#-metrika---enterprise-project-management-backend)

</div>
