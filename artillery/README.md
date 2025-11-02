# Load Testing with Artillery

Comprehensive performance and load testing suite for Metrika Backend API.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Test Scenarios](#test-scenarios)
- [Running Tests](#running-tests)
- [Performance Targets](#performance-targets)
- [Interpreting Results](#interpreting-results)
- [Troubleshooting](#troubleshooting)

---

## Overview

This directory contains Artillery load testing scenarios for:
- **Bulk Operations**: Concurrent bulk task creation, updates, assignment, deletion
- **Kanban Operations**: Drag-and-drop, board view, Gantt chart
- **Export Operations**: Excel and PDF export generation under load

**Artillery** is a modern load testing toolkit that:
- Supports HTTP, WebSocket, Socket.io protocols
- Provides detailed metrics (latency, throughput, error rate)
- Validates responses with assertions
- Supports custom JavaScript processors

---

## Prerequisites

### 1. Install Dependencies

```bash
# Artillery already installed in devDependencies
npm install

# Or install globally
npm install -g artillery
```

### 2. Start Backend Server

```bash
# Start PostgreSQL, Redis, MinIO
docker-compose up -d postgres redis minio

# Run database migrations
npx prisma migrate deploy

# Seed database with test data
npm run seed

# Start backend server
npm run dev
```

Server should be running at `http://localhost:3000`.

### 3. Prepare Test Data

Ensure database has:
- At least 1 project (projectId: 1)
- Test users:
  - `pm1@metrika.com` / `Password123!` (PM role)
  - `sysadmin@metrika.com` / `Password123!` (SYSADMIN role)
- Some existing tasks (for update/delete scenarios)

---

## Test Scenarios

### 1. Bulk Operations (`bulk-operations.yml`)

**Purpose**: Test bulk task operations at scale

**Scenarios**:
- **Bulk Task Creation**: Create 50 tasks in single request
- **Bulk Task Update**: Update 20 tasks simultaneously
- **Bulk Task Assignment**: Assign 30 tasks to user
- **Bulk Task Deletion**: Soft delete 10 completed tasks
- **Bulk Comment Creation**: Add comments to multiple tasks

**Load Profile**:
- Warm-up: 5 req/sec for 60s
- Sustained: 50 req/sec for 300s (5 minutes)
- Spike: 100 req/sec for 60s
- Cool-down: 10 req/sec for 60s

**Performance Targets**:
- p95 response time: < 2 seconds
- p99 response time: < 3 seconds
- Error rate: < 1%

### 2. Kanban Operations (`kanban-operations.yml`)

**Purpose**: Simulate real user drag-and-drop interactions

**Scenarios**:
- **Get Kanban Board**: Fetch board view (most frequent, 40% weight)
- **Drag Between Columns**: Move task to different status (30% weight)
- **Reorder Within Column**: Change task position (20% weight)
- **Get Gantt Timeline**: Fetch timeline view (5% weight)
- **User Workflow**: Multiple sequential drags (5% weight)

**Load Profile**:
- Warm-up: 5 req/sec for 30s
- Normal: 30 req/sec for 180s (3 minutes)
- Peak: 100 req/sec for 120s (2 minutes)
- Cool-down: 5 req/sec for 30s

**Performance Targets**:
- p95 response time: < 1.5 seconds (stricter for UX)
- p99 response time: < 2.5 seconds
- Error rate: < 0.5%

### 3. Export Operations (`export-operations.yml`)

**Purpose**: Test resource-intensive export generation

**Scenarios**:
- **Excel Export - Small**: < 100 tasks (40% weight)
- **Excel Export - Large**: 500+ tasks (20% weight)
- **PDF Export - Small**: < 100 tasks with charts (25% weight)
- **PDF Export - Large**: All tasks with charts (10% weight)
- **Concurrent Exports**: Multiple simultaneous exports (5% weight)

**Load Profile**:
- Warm-up: 2 req/sec for 30s
- Moderate: 10 req/sec for 120s (2 minutes)
- Heavy: 20 req/sec for 60s
- Cool-down: 2 req/sec for 30s

**Performance Targets**:
- p95 response time: < 3 seconds
- p99 response time: < 5 seconds
- Error rate: < 1%

---

## Running Tests

### Run All Tests

```bash
# Navigate to artillery directory
cd artillery

# Run bulk operations test
artillery run bulk-operations.yml

# Run Kanban operations test
artillery run kanban-operations.yml

# Run export operations test
artillery run export-operations.yml
```

### Run with Custom Configuration

```bash
# Override target URL
artillery run -t http://staging.metrika.com bulk-operations.yml

# Override environment variable
artillery run -e staging bulk-operations.yml

# Increase duration
artillery run --overrides '{"config":{"phases":[{"duration":600,"arrivalRate":50}]}}' bulk-operations.yml

# Output to JSON for analysis
artillery run bulk-operations.yml --output report.json

# Generate HTML report
artillery report report.json --output report.html
```

### Run with Docker (Isolated Environment)

```bash
# Build Artillery container
docker run --rm -it \
  -v $(pwd):/artillery \
  artilleryio/artillery:latest \
  run /artillery/bulk-operations.yml
```

### Quick Smoke Test (1 minute)

```bash
# Short test to verify everything works
artillery quick --count 10 --num 100 http://localhost:3000/api/v1/health
```

---

## Performance Targets

### Success Criteria

| Metric | Target | Critical |
|--------|--------|----------|
| **Response Time p50** | < 500ms | < 1s |
| **Response Time p95** | < 2s | < 3s |
| **Response Time p99** | < 3s | < 5s |
| **Error Rate** | < 1% | < 5% |
| **Throughput** | > 50 req/sec | > 30 req/sec |
| **Memory Usage** | < 512MB | < 1GB |
| **CPU Usage** | < 80% | < 95% |

### By Operation Type

**Bulk Operations**:
- Create 50 tasks: < 2s
- Update 20 tasks: < 1s
- Assign 30 tasks: < 1.5s
- Delete 10 tasks: < 500ms

**Kanban Operations**:
- Get board: < 300ms
- Drag task: < 500ms
- Reorder: < 400ms
- Gantt view: < 1s

**Export Operations**:
- Excel small: < 2s
- Excel large: < 5s
- PDF small: < 3s
- PDF large: < 8s

---

## Interpreting Results

### Artillery Output

```bash
Summary report @ 14:23:45
  Scenarios launched:  15000
  Scenarios completed: 14850
  Requests completed:  59400
  Mean response/sec: 198.00
  Response time (msec):
    min: 45
    max: 3421
    median: 356
    p95: 1842
    p99: 2753
  Scenario counts:
    Bulk Task Creation - 50 tasks: 4500 (30%)
    Bulk Task Update - 20 tasks: 3712 (24.8%)
  Codes:
    200: 58200
    201: 1200
    500: 150 (0.25% error rate)
```

**Key Metrics Explained**:
- **Scenarios launched**: Total virtual users created
- **Scenarios completed**: Successfully finished workflows
- **Mean response/sec**: Throughput (higher = better)
- **Response time p95**: 95% of requests faster than this
- **Codes**: HTTP status code distribution

### Pass/Fail Criteria

✅ **PASS** if:
- p95 < target threshold
- p99 < target threshold
- Error rate < 1%
- All assertions passed

❌ **FAIL** if:
- p95 or p99 exceeds threshold
- Error rate > 1%
- Any assertion failed
- Scenarios incomplete

### HTML Report

Generate visual report:
```bash
artillery run bulk-operations.yml --output report.json
artillery report report.json --output report.html
open report.html
```

Report includes:
- Response time graphs
- Throughput over time
- Error rate timeline
- Latency distribution
- Scenario completion rates

---

## Monitoring During Tests

### 1. Server Metrics

**CPU & Memory** (Linux):
```bash
# Watch CPU usage
top -p $(pgrep -f "node.*server")

# Watch memory usage
watch -n 1 'free -m'
```

**CPU & Memory** (Windows PowerShell):
```powershell
# Watch Node.js process
Get-Process node | Format-Table -AutoSize
```

### 2. Database Connections

```bash
# PostgreSQL connection count
docker exec metrika-postgres psql -U metrika -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='metrika';"

# Active queries
docker exec metrika-postgres psql -U metrika -c \
  "SELECT pid, usename, state, query FROM pg_stat_activity WHERE datname='metrika';"
```

### 3. Redis Metrics

```bash
# Redis stats
docker exec metrika-redis redis-cli INFO stats

# Monitor commands in real-time
docker exec metrika-redis redis-cli MONITOR
```

### 4. Queue Metrics

Access queue monitoring dashboard:
```bash
# While test is running
curl http://localhost:3000/api/v1/monitoring/queues \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Troubleshooting

### Issue 1: High Error Rate

**Symptoms**: > 5% errors (500, 503, 504)

**Causes**:
- Database connection pool exhausted
- Redis connection issues
- Memory leak
- Timeout too short

**Solutions**:
```bash
# Increase database pool size
# Edit .env
DATABASE_URL="postgresql://user:pass@localhost:5432/metrika?connection_limit=50"

# Increase Node.js memory
NODE_OPTIONS=--max-old-space-size=4096 npm run dev

# Increase HTTP timeout in artillery.yml
config:
  http:
    timeout: 30  # 30 seconds
```

### Issue 2: Slow Response Times

**Symptoms**: p95 > 5 seconds

**Causes**:
- Missing database indexes
- N+1 query problem
- CPU bottleneck
- No connection pooling

**Solutions**:
```sql
-- Add indexes to slow queries
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

-- Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### Issue 3: Memory Leak

**Symptoms**: Memory usage grows continuously

**Causes**:
- Event listeners not removed
- Large objects in cache
- File handles not closed

**Solutions**:
```bash
# Profile memory with Node.js
node --inspect server.js
# Open chrome://inspect
# Take heap snapshots before/after test

# Or use clinic.js
npx clinic doctor -- node server.js
# Run artillery test
# Ctrl+C to stop
# Open generated HTML report
```

### Issue 4: Connection Pool Exhausted

**Symptoms**: "ECONNREFUSED" or "Connection pool timeout"

**Causes**:
- Too many concurrent connections
- Pool size too small
- Connections not released

**Solutions**:
```typescript
// Increase Prisma pool size (prisma-client.ts)
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=50'
    }
  }
});

// Increase Redis pool
const redis = new Redis({
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});
```

### Issue 5: Authentication Failures

**Symptoms**: 401 Unauthorized errors

**Causes**:
- Token expired during long test
- Wrong credentials
- Rate limiting

**Solutions**:
```yaml
# Increase token TTL in .env
AUTH_ACCESS_TOKEN_TTL=7200  # 2 hours

# Or re-authenticate in artillery processor
module.exports = {
  refreshToken(context, events, done) {
    // Re-login if token expired
    if (Date.now() > context.vars.tokenExpiry) {
      // Trigger re-auth
    }
    return done();
  }
};
```

---

## Best Practices

### 1. Progressive Load Testing

Start small, increase gradually:
```bash
# Step 1: Smoke test (10 users, 1 minute)
artillery quick --count 10 --num 100 http://localhost:3000/api/v1/health

# Step 2: Load test (50 users, 5 minutes)
artillery run bulk-operations.yml

# Step 3: Stress test (100 users, 10 minutes)
# Edit bulk-operations.yml, increase duration and arrivalRate

# Step 4: Spike test (instant 500 users)
# Add spike phase to bulk-operations.yml
```

### 2. Isolate Tests

Run one scenario at a time:
```bash
# Test only bulk creation
artillery run --scenario "Bulk Task Creation" bulk-operations.yml
```

### 3. Clean Up After Tests

```bash
# Delete test data
npm run db:reset

# Restart services
docker-compose restart postgres redis
```

### 4. CI/CD Integration

```yaml
# .github/workflows/load-test.yml
name: Load Test
on:
  push:
    branches: [main]

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Start services
        run: docker-compose up -d
      - name: Run migrations
        run: npx prisma migrate deploy
      - name: Start server
        run: npm run dev &
      - name: Wait for server
        run: sleep 10
      - name: Run artillery
        run: artillery run artillery/bulk-operations.yml
      - name: Upload report
        uses: actions/upload-artifact@v2
        with:
          name: load-test-report
          path: report.html
```

---

## Additional Resources

- **Artillery Documentation**: https://www.artillery.io/docs
- **Performance Testing Best Practices**: https://www.artillery.io/docs/guides/getting-started/core-concepts
- **Load Testing Checklist**: https://www.artillery.io/blog/load-testing-checklist

---

## Support

For issues or questions:
- **Email**: support@metrika.com
- **Slack**: #backend-support
- **Documentation**: https://docs.metrika.com
