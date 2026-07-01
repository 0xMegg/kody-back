#!/usr/bin/env node
/*
 * Local-only product/log CRUD harness for KODY backend.
 *
 * Safety posture:
 * - refuses non-local base URLs by default;
 * - reads .env without printing secrets/URLs;
 * - uses HTTP calls against an already-running local backend;
 * - avoids deletes and cleans up by hiding/off-sale marking plus compensating stock adjustment;
 * - writes evidence only under the workspace .hermes/evidence directory.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const DEFAULT_BASE_URL = 'http://localhost:4000';
const DEFAULT_EVIDENCE_JSON = path.join(
  WORKSPACE_ROOT,
  '.hermes/evidence/2026-07-01-product-log-crud-local-result.json',
);
const DEFAULT_EVIDENCE_MD = path.join(
  WORKSPACE_ROOT,
  '.hermes/evidence/2026-07-01-product-log-crud-local-result.md',
);
const EVIDENCE_ROOT = path.join(WORKSPACE_ROOT, '.hermes/evidence');

const ROLES = ['ADMIN', 'FINANCE', 'OPERATIONS', 'WAREHOUSE', 'SALES'];
const WRITE_VALIDATION_BODY = {}; // permission probe: 403 when unauthorized, 400 when authorized but invalid.
const USER_AGENT = 'kody-local-product-log-crud-harness/2026-07-01';
const PHASE_NAMES = [
  'Phase 0 env/migration/storage summary',
  'Phase 1 read-only boundary/log total',
  'Phase 2 role matrix no-side-effect probes',
  'Phase 3 minimal/full product create/list/search',
  'Phase 4 update/no-op/validation/variant probes',
  'Phase 5 inventory/movement/cleanup',
  'Phase 6 upload/import dry-run/export/external mapping auth probe',
  'Phase 7 log audit basics',
  'Phase 8 dev applicability packet',
  'Phase 9 reserved/no-op',
  'Phase 10 verdict',
  'Phase 11 closeout evidence',
];

function usage() {
  return `Usage: node scripts/local-product-log-crud-harness.mjs [options]\n\n` +
    `Local-only HTTP harness for product CRUD, inventory movements, permissions, and action logs.\n\n` +
    `Options:\n` +
    `  --base-url <url>       Local backend URL (default: ${DEFAULT_BASE_URL})\n` +
    `  --evidence-json <path> JSON evidence output path (must be under ${EVIDENCE_ROOT})\n` +
    `  --evidence-md <path>   Markdown summary output path (must be under ${EVIDENCE_ROOT})\n` +
    `  --allow-any-local      Permit any loopback localhost/127.0.0.1 port/path URL\n` +
    `  --help                 Show this help and exit without DB or HTTP writes\n\n` +
    `Safety: the harness refuses non-localhost/127.0.0.1 base URLs and never prints tokens, AUTH_JWT_SECRET, or DATABASE_URL.\n`;
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    evidenceJson: DEFAULT_EVIDENCE_JSON,
    evidenceMd: DEFAULT_EVIDENCE_MD,
    allowAnyLocal: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--allow-any-local') {
      options.allowAnyLocal = true;
    } else if (arg === '--base-url') {
      options.baseUrl = requireValue(argv, ++i, arg);
    } else if (arg === '--evidence-json') {
      options.evidenceJson = normalizeAndAssertEvidencePath(requireValue(argv, ++i, arg), arg);
    } else if (arg === '--evidence-md') {
      options.evidenceMd = normalizeAndAssertEvidencePath(requireValue(argv, ++i, arg), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  options.baseUrl = normalizeAndAssertLocalBaseUrl(options.baseUrl, options.allowAnyLocal);
  options.evidenceJson = normalizeAndAssertEvidencePath(options.evidenceJson, '--evidence-json');
  options.evidenceMd = normalizeAndAssertEvidencePath(options.evidenceMd, '--evidence-md');
  return options;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function normalizeAndAssertLocalBaseUrl(raw, allowAnyLocal) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  if (!isLocalhost) {
    throw new Error(`Refusing non-local base URL host: ${hostname}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
  }
  const isDefaultPortLoopback =
    url.protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    (url.port === '4000' || url.port === '');
  if (!allowAnyLocal && !isDefaultPortLoopback) {
    throw new Error('Refusing base URL outside localhost/127.0.0.1:4000; pass --allow-any-local for another loopback URL.');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeAndAssertEvidencePath(raw, flag) {
  const resolved = path.resolve(raw);
  const relative = path.relative(EVIDENCE_ROOT, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${flag} must stay under the workspace evidence directory: ${EVIDENCE_ROOT}`);
  }
  return resolved;
}

function loadEnv() {
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });
  if (!process.env.AUTH_JWT_SECRET) {
    throw new Error('AUTH_JWT_SECRET is required in .env/environment (value is intentionally not printed).');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in .env/environment (value is intentionally not printed).');
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function issueAccessToken(user, now = new Date()) {
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const body = encodeJson({
    sub: user.id,
    email: user.email,
    roles: user.roles,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  const signature = createHmac('sha256', process.env.AUTH_JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function git(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd: BACKEND_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function provenance() {
  const status = git(['status', '--porcelain'], '');
  return {
    backendRoot: BACKEND_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    gitHead: git(['rev-parse', 'HEAD'], 'UNKNOWN'),
    gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'UNKNOWN'),
    gitDirty: status.length > 0,
    dirtyLineCount: status ? status.split('\n').filter(Boolean).length : 0,
  };
}

async function selectUsersByRole(prisma) {
  const activeUsers = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    include: { roles: { select: { role: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const byRole = {};
  for (const role of ROLES) {
    const exactRoleUser = activeUsers.find((candidate) => {
      const roles = candidate.roles.map((entry) => entry.role);
      return roles.length === 1 && roles[0] === role;
    });
    const fallbackUser = activeUsers.find((candidate) => candidate.roles.some((entry) => entry.role === role));
    const user = exactRoleUser ?? fallbackUser;
    if (user) {
      const roles = user.roles.map((entry) => entry.role);
      const exactRole = roles.length === 1 && roles[0] === role;
      byRole[role] = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles,
        exactRole,
        selectionWarning: exactRole ? null : `No ACTIVE exact single-role ${role} user found; using ACTIVE user with additional roles.`,
        token: issueAccessToken({ id: user.id, email: user.email, roles }),
      };
    }
  }
  return byRole;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    exactRole: user.exactRole,
    selectionWarning: user.selectionWarning,
    tokenIssued: Boolean(user.token),
  };
}

class Harness {
  constructor(options) {
    this.options = options;
    this.runId = randomBytes(4).toString('hex');
    this.timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    this.namespace = `KODY-CRUD-${this.timestamp}-${this.runId}`;
    this.steps = [];
    this.phaseResults = PHASE_NAMES.map((name, index) => ({ phase: index, name, status: 'PENDING', startedAt: null, finishedAt: null, details: {} }));
    this.createdProductIds = [];
    this.createdProductId = null;
    this.netInventoryDeltaByProductId = {};
    this.netInventoryDelta = 0;
    this.cleanupErrors = [];
    this.storageSummary = null;
    this.baselineCounts = null;
    this.finalCounts = null;
    this.devApplicabilityPacket = null;
  }

  record(name, status, details = {}) {
    this.steps.push({ name, status, details, at: new Date().toISOString() });
  }

  beginPhase(phase, details = {}) {
    const current = this.phaseResults[phase];
    if (current) {
      current.status = 'RUNNING';
      current.startedAt = new Date().toISOString();
      current.details = { ...current.details, ...details };
    }
  }

  endPhase(phase, status = 'PASS', details = {}) {
    const current = this.phaseResults[phase];
    if (current) {
      current.status = status;
      current.finishedAt = new Date().toISOString();
      current.details = { ...current.details, ...details };
    }
  }

  async phase(phase, action) {
    this.beginPhase(phase);
    try {
      const details = await action();
      this.endPhase(phase, 'PASS', details ?? {});
      return details;
    } catch (error) {
      this.endPhase(phase, 'FAIL', { error: serializeError(error) });
      throw error;
    }
  }

  async request(label, method, pathname, { token, body, expectedStatuses } = {}) {
    const url = new URL(pathname, `${this.options.baseUrl}/`);
    const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { rawText: text.slice(0, 1000) };
      }
    }
    const result = {
      label,
      method,
      path: `${url.pathname}${url.search}`,
      status: response.status,
      okEnvelope: parsed && typeof parsed === 'object' ? parsed.ok : undefined,
      errorCode: parsed?.error?.code,
      dataSummary: summarizeData(parsed?.data),
    };
    this.record(label, expectedStatuses?.includes(response.status) ? 'PASS' : 'OBSERVED', result);
    if (expectedStatuses && !expectedStatuses.includes(response.status)) {
      const err = new Error(`${label} expected HTTP ${expectedStatuses.join('/')} but got ${response.status}`);
      err.result = result;
      err.response = parsed;
      throw err;
    }
    return { response, body: parsed, result };
  }

  async run(users, prisma) {
    const admin = users.ADMIN;
    if (!admin) {
      throw new Error('No ACTIVE ADMIN user found in local DB; cannot run write-scoped harness safely.');
    }

    let phaseError = null;
    try {
      await this.phase(0, () => this.phase0EnvironmentSummary(prisma));
      await this.phase(1, () => this.phase1HealthAndBaseline(admin, prisma));
      await this.phase(2, () => this.phase2RoleMatrix(users, prisma));
      await this.phase(3, () => this.phase3ProductCreateListSearch(admin));
      await this.phase(4, () => this.phase4UpdateValidationVariants(admin));
      await this.phase(5, () => this.phase5InventoryMovement(admin));
      await this.phase(6, () => this.phase6UploadImportExportMapping(admin, users));
      await this.phase(7, () => this.phase7ActionLogs(admin));
      await this.phase(8, () => this.phase8DevApplicabilityPacket());
      this.endPhase(9, 'SKIP', { reason: 'No Phase 9 local action defined by this plan.' });
    } catch (error) {
      phaseError = error;
    } finally {
      await this.cleanup(admin);
    }
    if (phaseError) {
      if (this.cleanupErrors.length > 0) {
        phaseError.cleanupErrors = this.cleanupErrors.map((error) => serializeError(error));
      }
      throw phaseError;
    }
    if (this.cleanupErrors.length > 0) {
      throw new AggregateError(this.cleanupErrors, 'Cleanup failed after successful phases');
    }
  }

  async phase0EnvironmentSummary(prisma) {
    const envPath = path.join(BACKEND_ROOT, '.env');
    const migrationsDir = path.join(BACKEND_ROOT, 'prisma/migrations');
    const storageCandidates = ['uploads', 'storage', 'tmp', '.hermes/evidence'];
    const envPresent = await exists(envPath);
    const migrations = await safeListDirs(migrationsDir);
    const storage = {};
    for (const candidate of storageCandidates) {
      const fullPath = path.join(candidate.startsWith('.hermes') ? WORKSPACE_ROOT : BACKEND_ROOT, candidate);
      storage[candidate] = await pathSummary(fullPath);
    }
    const counts = await localCounts(prisma);
    this.storageSummary = {
      envPresent,
      envKeysPresent: {
        AUTH_JWT_SECRET: Boolean(process.env.AUTH_JWT_SECRET),
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
      },
      migrations: { count: migrations.length, latest: migrations.at(-1) ?? null },
      storage,
      counts,
    };
    this.record('phase 0 env/migration/storage summary', 'PASS', this.storageSummary);
    return this.storageSummary;
  }

  async phase1HealthAndBaseline(admin, prisma) {
    await this.request('health', 'GET', '/health', { expectedStatuses: [200] });
    const products = await this.request('baseline products list', 'GET', '/products?limit=3', { token: admin.token, expectedStatuses: [200] });
    const logs = await this.request('baseline logs list', 'GET', '/logs?page=1&pageSize=3', { token: admin.token, expectedStatuses: [200] });
    const productBoundary = await this.request('read-only boundary rejects unauthenticated products', 'GET', '/products?limit=1', { expectedStatuses: [401] });
    const logBoundary = await this.request('read-only boundary rejects unauthenticated logs', 'GET', '/logs?page=1&pageSize=1', { expectedStatuses: [401] });
    await this.request('import commit disabled', 'POST', '/products/import/commit', {
      token: admin.token,
      body: {},
      expectedStatuses: [403],
    });

    const listed = await this.request('export candidate list', 'GET', '/products?limit=1', {
      token: admin.token,
      expectedStatuses: [200],
    });
    const productId = listed.body?.data?.items?.[0]?.id;
    if (productId) {
      await this.request('safe imweb export one product', 'POST', '/products/export/imweb', {
        token: admin.token,
        body: { productIds: [productId] },
        expectedStatuses: [200],
      });
    } else {
      this.record('safe imweb export one product', 'SKIP', { reason: 'No existing product returned by /products?limit=1' });
    }
    this.baselineCounts = await localCounts(prisma);
    return {
      productItemsObserved: products.body?.data?.items?.length ?? null,
      logTotal: logs.body?.data?.pagination?.total ?? null,
      unauthenticatedStatuses: { products: productBoundary.result.status, logs: logBoundary.result.status },
      dbCounts: this.baselineCounts,
    };
  }

  async phase2RoleMatrix(users, prisma) {
    const matrix = [];
    for (const role of ROLES) {
      const user = users[role];
      if (!user) {
        this.record(`role ${role} selected user`, 'SKIP', { reason: `No ACTIVE user with ${role}` });
        matrix.push({ role, status: 'SKIP' });
        continue;
      }
      if (!user.exactRole) {
        this.record(`role ${role} exact-role preference`, 'WARN', {
          reason: user.selectionWarning,
          user: publicUser(user),
        });
      }
      this.record(`role ${role} selected user`, 'PASS', { user: publicUser(user) });
      await this.request(`role ${role} read products`, 'GET', '/products?limit=1', {
        token: user.token,
        expectedStatuses: [200],
      });
      await this.request(`role ${role} read logs`, 'GET', '/logs?page=1&pageSize=1', {
        token: user.token,
        expectedStatuses: [200],
      });
      const before = await localCounts(prisma);
      const expectedWriteProbe = role === 'SALES' ? [403] : [400];
      await this.request(`role ${role} product write permission probe`, 'POST', '/products', {
        token: user.token,
        body: WRITE_VALIDATION_BODY,
        expectedStatuses: expectedWriteProbe,
      });
      const after = await localCounts(prisma);
      const guardPassed = before.products === after.products && before.actionLogs === after.actionLogs && before.stockMovements === after.stockMovements;
      this.record(`role ${role} no-side-effect count guard`, guardPassed ? 'PASS' : 'FAIL', { before, after });
      if (!guardPassed) {
        throw new Error(`Role ${role} validation probe changed product/log/movement counts`);
      }
      matrix.push({ role, expectedWriteProbe, guardPassed });
    }
    return { roles: matrix };
  }

  minimalProductBody() {
    return {
      name: `${this.namespace} minimal local harness product`,
      priceKRW: '1000.0000',
      sku: `${this.namespace}-MIN-SKU`,
      barcode: `${this.namespace}-MIN-BARCODE`,
      saleStatus: 'DRAFT',
      isDisplayed: false,
    };
  }

  fullProductBody() {
    return {
      name: `${this.namespace} local harness product`,
      priceKRW: '12345.0000',
      category: 'GOODS',
      categoryMinor: 'OFFICIAL_GOODS',
      itemType: 'MD',
      sku: `${this.namespace}-SKU`,
      barcode: `${this.namespace}-BARCODE`,
      avgPurchasePriceKRW: 7000,
      initialStockOnHand: 0,
      stockManaged: true,
      saleStatus: 'DRAFT',
      isDisplayed: false,
      categoryMappingSource: 'MANUAL',
      sourceCategoryCodes: [this.namespace],
      categoryReviewStatus: 'MAPPED',
      variants: [
        {
          name: 'Default',
          priceKRW: '12345.0000',
          sku: `${this.namespace}-VAR-SKU`,
          barcode: `${this.namespace}-VAR-BARCODE`,
          position: 0,
        },
      ],
    };
  }

  async phase3ProductCreateListSearch(admin) {
    const minimal = await this.request('minimal product create', 'POST', '/products', {
      token: admin.token,
      body: this.minimalProductBody(),
      expectedStatuses: [201],
    });
    const minimalProductId = minimal.body?.data?.id;
    if (!minimalProductId) throw new Error('Minimal product create did not return data.id');
    this.createdProductIds.push(minimalProductId);
    this.netInventoryDeltaByProductId[minimalProductId] = 0;

    const created = await this.request('full product create', 'POST', '/products', {
      token: admin.token,
      body: this.fullProductBody(),
      expectedStatuses: [201],
    });
    this.createdProductId = created.body?.data?.id;
    if (!this.createdProductId) {
      throw new Error('Full product create did not return data.id');
    }
    this.createdProductIds.push(this.createdProductId);
    this.netInventoryDeltaByProductId[this.createdProductId] = 0;

    await this.request('minimal product get after create', 'GET', `/products/${encodeURIComponent(minimalProductId)}`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    const fullGet = await this.request('full product get after create', 'GET', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    await this.request('product list includes namespace', 'GET', `/products?limit=10&q=${encodeURIComponent(this.namespace)}`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    await this.request('product search by sku', 'GET', `/products?limit=10&q=${encodeURIComponent(`${this.namespace}-SKU`)}`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    return { minimalProductId, fullProductId: this.createdProductId, fullGet: fullGet.result.dataSummary };
  }

  async phase4UpdateValidationVariants(admin) {
    if (!this.createdProductId) throw new Error('No full product ID for update phase');
    await this.request('product update detail html', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { detailHtml: `<p data-kody-crud-run="${this.runId}">${this.namespace} updated detail</p>` },
      expectedStatuses: [200],
    });
    await this.request('product no-op update stable fields', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { name: `${this.namespace} local harness product`, saleStatus: 'DRAFT', isDisplayed: false },
      expectedStatuses: [200],
    });
    await this.request('product validation rejects direct stock', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { stockOnHand: 99 },
      expectedStatuses: [400],
    });
    await this.request('product validation rejects public sale generic patch', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { publicSaleWindowStatus: 'APPROVED' },
      expectedStatuses: [400],
    });
    await this.request('product validation rejects variant stock field', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { variants: [{ name: 'Invalid Stock Variant', priceKRW: '12345.0000', stockOnHand: 1 }] },
      expectedStatuses: [400],
    });
    await this.request('product variant replace valid', 'PATCH', `/products/${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      body: { variants: [{ name: 'Default Updated', priceKRW: '12345.0000', sku: `${this.namespace}-VAR-SKU-2`, barcode: `${this.namespace}-VAR-BARCODE-2`, position: 0 }] },
      expectedStatuses: [200],
    });
    return { productId: this.createdProductId };
  }

  async phase5InventoryMovement(admin) {
    if (!this.createdProductId) throw new Error('No full product ID for inventory phase');
    await this.request('inventory inbound +5', 'POST', `/products/${encodeURIComponent(this.createdProductId)}/inbound`, {
      token: admin.token,
      body: { quantity: 5, reason: `${this.namespace} local harness inbound` },
      expectedStatuses: [201],
    });
    this.trackInventoryDelta(this.createdProductId, 5);
    await this.request('inventory adjust -2', 'POST', `/products/${encodeURIComponent(this.createdProductId)}/adjust`, {
      token: admin.token,
      body: { quantity: -2, reason: `${this.namespace} local harness adjustment` },
      expectedStatuses: [200],
    });
    this.trackInventoryDelta(this.createdProductId, -2);
    await this.request('inventory validation rejects missing reason', 'POST', `/products/${encodeURIComponent(this.createdProductId)}/adjust`, {
      token: admin.token,
      body: { quantity: 1 },
      expectedStatuses: [400],
    });
    await this.request('inventory movements list', 'GET', `/products/${encodeURIComponent(this.createdProductId)}/movements`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    return { productId: this.createdProductId, netInventoryDelta: this.netInventoryDeltaByProductId[this.createdProductId] };
  }

  trackInventoryDelta(productId, delta) {
    this.netInventoryDeltaByProductId[productId] = (this.netInventoryDeltaByProductId[productId] ?? 0) + delta;
    this.netInventoryDelta = Object.values(this.netInventoryDeltaByProductId).reduce((sum, value) => sum + value, 0);
  }

  async phase6UploadImportExportMapping(admin, users) {
    const dryRunWorkbook = await buildDryRunWorkbookBase64(this.namespace);
    await this.request('imweb upload/import dry-run valid workbook', 'POST', '/products/import/dry-run', {
      token: admin.token,
      body: {
        fileName: `${this.namespace}-dry-run.xlsx`,
        contentBase64: dryRunWorkbook.contentBase64,
        sizeBytes: dryRunWorkbook.sizeBytes,
      },
      expectedStatuses: [200],
    });
    await this.request('imweb upload rejects forbidden extension', 'POST', '/products/import/dry-run', {
      token: admin.token,
      body: { fileName: `${this.namespace}.xlsm`, contentBase64: Buffer.from('not-a-workbook').toString('base64'), sizeBytes: 14 },
      expectedStatuses: [400],
    });
    await this.request('safe imweb export created product', 'POST', '/products/export/imweb', {
      token: admin.token,
      body: { productIds: [this.createdProductId] },
      expectedStatuses: [200],
    });
    const nonAdminWriter = [users.FINANCE, users.OPERATIONS, users.WAREHOUSE, users.SALES]
      .find((candidate) => candidate && !candidate.roles.includes('ADMIN'));
    if (nonAdminWriter) {
      await this.request('external mapping correction non-admin auth probe', 'POST', '/products/external-mappings/correct', {
        token: nonAdminWriter.token,
        body: { mappingId: 'local-auth-probe', operation: 'DETACH', evidenceUrl: 'https://example.invalid/local-auth-probe', reason: `${this.namespace} auth probe` },
        expectedStatuses: [403],
      });
    } else {
      this.record('external mapping correction non-admin auth probe', 'SKIP', { reason: 'No non-admin active user available' });
    }
    this.record('external mapping correction admin mutation', 'SKIP', {
      reason: 'Risky external mapping mutation intentionally gated/skipped by default for local harness.',
      gate: 'requires explicit human approval and a disposable mappingId',
    });
    return { dryRunWorkbookBytes: dryRunWorkbook.sizeBytes, externalMappingMutation: 'SKIPPED_GATED' };
  }

  async phase7ActionLogs(admin) {
    if (!this.createdProductId) {
      this.record('action log checks', 'SKIP', { reason: 'No created product ID' });
      return { skipped: true };
    }
    const actionTypes = ['PRODUCT_CREATE', 'PRODUCT_UPDATE', 'INVENTORY_INBOUND', 'INVENTORY_ADJUST'];
    for (const actionType of actionTypes) {
      const checked = await this.request(`action log ${actionType}`, 'GET', `/logs?page=1&pageSize=10&targetType=Product&targetId=${encodeURIComponent(this.createdProductId)}&actionType=${actionType}`, {
        token: admin.token,
        expectedStatuses: [200],
      });
      const items = checked.body?.data?.items ?? [];
      const found = items.some((item) => item.actionType === actionType && item.targetId === this.createdProductId);
      this.record(`action log ${actionType} present`, found ? 'PASS' : 'FAIL', {
        targetId: this.createdProductId,
        observedCount: items.length,
        actorProjectionTolerated: items.map((item) => ({
          actorUserId: item.actorUserId ?? null,
          actorDisplayNamePresent: item.actorDisplayName !== undefined,
          actorEmailPresent: item.actorEmail !== undefined,
          actorEmployeeNamePresent: item.actorEmployeeName !== undefined,
        })),
      });
      if (!found) {
        throw new Error(`Missing expected action log ${actionType} for ${this.createdProductId}`);
      }
    }
    const audit = await this.request('action log product target audit projection', 'GET', `/logs?page=1&pageSize=10&targetType=Product&targetId=${encodeURIComponent(this.createdProductId)}`, {
      token: admin.token,
      expectedStatuses: [200],
    });
    return { checkedActionTypes: actionTypes, auditTotal: audit.body?.data?.pagination?.total ?? null };
  }

  async phase8DevApplicabilityPacket() {
    this.devApplicabilityPacket = {
      devRunStatus: 'DEV_NOT_RUN_GATED',
      reason: 'This harness is local-only; dev/prod execution requires explicit human approval and environment-specific credentials.',
      localBaseUrl: this.options.baseUrl,
      reusableEvidence: ['phaseResults', 'steps', 'usersByRole', 'createdProductIds', 'storageSummary'],
      riskyGates: ['external mapping mutation', 'import commit', 'non-local base URL'],
    };
    this.record('dev applicability packet', 'PASS', this.devApplicabilityPacket);
    return this.devApplicabilityPacket;
  }

  async cleanup(admin) {
    if (this.createdProductIds.length === 0) return;
    for (const productId of this.createdProductIds) {
      const delta = this.netInventoryDeltaByProductId[productId] ?? 0;
      await this.cleanupStep(`cleanup ${productId} compensating adjust ${-delta}`, async () => {
        if (delta === 0) return;
        await this.request(`cleanup ${productId} compensating adjust ${-delta}`, 'POST', `/products/${encodeURIComponent(productId)}/adjust`, {
          token: admin.token,
          body: { quantity: -delta, reason: `${this.namespace} local harness cleanup compensation` },
          expectedStatuses: [200],
        });
        this.trackInventoryDelta(productId, -delta);
      });
      await this.cleanupStep(`cleanup ${productId} mark hidden/off-sale`, async () => {
        await this.request(`cleanup ${productId} mark hidden/off-sale`, 'PATCH', `/products/${encodeURIComponent(productId)}`, {
        token: admin.token,
        body: { saleStatus: 'OFF_SALE', isDisplayed: false },
        expectedStatuses: [200],
      });
      });
      await this.cleanupStep(`cleanup ${productId} public sale window draft`, async () => {
        await this.request(`cleanup ${productId} public sale window draft`, 'PATCH', `/products/${encodeURIComponent(productId)}/public-sale-window`, {
          token: admin.token,
          body: { publicSaleWindowStatus: 'DRAFT', publicSaleStartsAt: null, publicSaleEndsAt: null, reason: `${this.namespace} cleanup draft` },
          expectedStatuses: [200],
        });
      });
    }
  }

  async cleanupStep(name, action) {
    try {
      await action();
    } catch (error) {
      this.cleanupErrors.push(error);
      this.record(`${name} cleanup error`, 'FAIL', { error: serializeError(error) });
    }
  }
}

function serializeError(error) {
  return {
    name: error?.name,
    message: error?.message ?? String(error),
    result: error?.result,
    errors: Array.isArray(error?.errors) ? error.errors.map((entry) => serializeError(entry)) : undefined,
    cleanupErrors: error?.cleanupErrors,
  };
}

function summarizeData(data) {
  if (data === undefined) return undefined;
  if (data === null) return null;
  if (Array.isArray(data)) return { type: 'array', length: data.length };
  if (typeof data !== 'object') return data;
  const summary = { keys: Object.keys(data).slice(0, 20) };
  if (typeof data.id === 'string') summary.id = data.id;
  if (Array.isArray(data.items)) summary.itemsLength = data.items.length;
  if (data.pagination) summary.pagination = data.pagination;
  if (data.nextCursor !== undefined) summary.nextCursor = data.nextCursor;
  if (data.fileName) summary.fileName = data.fileName;
  if (data.rowCount !== undefined) summary.rowCount = data.rowCount;
  return summary;
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeListDirs(targetPath) {
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function pathSummary(targetPath) {
  try {
    const info = await stat(targetPath);
    const result = { exists: true, type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other' };
    if (info.isDirectory()) {
      const entries = await readdir(targetPath);
      result.entryCount = entries.length;
    } else if (info.isFile()) {
      result.sizeBytes = info.size;
    }
    return result;
  } catch {
    return { exists: false };
  }
}

async function localCounts(prisma) {
  const [products, productVariants, stockMovements, actionLogs, externalMappings] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.stockMovement.count(),
    prisma.actionLog.count(),
    prisma.productExternalMapping.count(),
  ]);
  return { products, productVariants, stockMovements, actionLogs, externalMappings };
}

async function buildDryRunWorkbookBase64(namespace) {
  const XLSX = await import('@e965/xlsx');
  const rows = [{
    상품번호: `${namespace}-EXT-1`,
    상품명: `${namespace} Dry Run Product`,
    카테고리ID: 'CATE70,CATE65',
    판매가: '17440',
    무게: '1',
    원가: '0',
    재고사용: 'Y',
    '현재 재고수량': '1',
    재고번호SKU: `${namespace}-DRY-SKU`,
    원산지: `${namespace}-DRY-BARCODE`,
    제조사: '2026-04-30',
    브랜드: 'LOCAL HARNESS',
    옵션사용: 'N',
    진열상태: 'N',
    판매상태: '판매중',
  }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '상품');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return { contentBase64: Buffer.from(buffer).toString('base64'), sizeBytes: Buffer.byteLength(buffer) };
}

function buildDevVerdict(evidence) {
  const failedPhases = evidence.phaseResults.filter((phase) => phase.status === 'FAIL');
  const failedSteps = evidence.steps.filter((step) => step.status === 'FAIL');
  return {
    localStatus: evidence.status,
    devStatus: 'DEV_NOT_RUN_GATED',
    verdict: evidence.status === 'PASS' ? 'LOCAL_PASS_DEV_NOT_RUN_GATED' : 'LOCAL_FAIL_DEV_NOT_RUN_GATED',
    failedPhases: failedPhases.map((phase) => ({ phase: phase.phase, name: phase.name, error: phase.details?.error?.message ?? null })),
    failedStepCount: failedSteps.length,
    gates: ['non-local base URL refused by default', 'import commit disabled', 'external mapping mutation skipped by default'],
  };
}

function buildCloseout(evidence, phaseStatusOverride = null) {
  return {
    evidenceJson: evidence.evidencePaths.json,
    evidenceMarkdown: evidence.evidencePaths.markdown,
    changedHarness: 'scripts/local-product-log-crud-harness.mjs',
    createdProductIds: evidence.createdProductIds,
    cleanupNetInventoryDelta: evidence.netInventoryDelta,
    cleanupErrors: evidence.cleanupErrors,
    phaseStatuses: evidence.phaseResults.map((phase) => ({
      phase: phase.phase,
      status: phaseStatusOverride?.get(phase.phase) ?? phase.status,
    })),
    devRunStatus: evidence.devVerdict.devStatus,
    piiPolicy: 'Markdown masks user email local parts; JSON preserves local evidence for machine verification.',
  };
}

async function writeEvidence(harness, startedAt, finishedAt, users, prov, error = null) {
  const evidencePaths = { json: harness.options.evidenceJson, markdown: harness.options.evidenceMd };
  const evidence = {
    harness: 'scripts/local-product-log-crud-harness.mjs',
    localOnly: true,
    startedAt,
    finishedAt,
    baseUrl: harness.options.baseUrl,
    namespace: harness.namespace,
    runId: harness.runId,
    provenance: prov,
    usersByRole: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, publicUser(user)])),
    evidencePaths,
    phaseResults: harness.phaseResults,
    storageSummary: harness.storageSummary,
    baselineCounts: harness.baselineCounts,
    finalCounts: harness.finalCounts,
    devApplicabilityPacket: harness.devApplicabilityPacket,
    createdProductIds: harness.createdProductIds,
    createdProductId: harness.createdProductId,
    netInventoryDeltaByProductId: harness.netInventoryDeltaByProductId,
    netInventoryDelta: harness.netInventoryDelta,
    cleanupErrors: harness.cleanupErrors.map((entry) => serializeError(entry)),
    status: error ? 'FAIL' : 'PASS',
    error: error ? serializeError(error) : null,
    steps: harness.steps,
  };
  evidence.devVerdict = buildDevVerdict(evidence);
  harness.endPhase(10, evidence.status === 'PASS' ? 'PASS' : 'FAIL', evidence.devVerdict);
  evidence.phaseResults = harness.phaseResults;
  harness.endPhase(11, 'PASS', { pending: true });
  evidence.phaseResults = harness.phaseResults;
  evidence.closeout = buildCloseout(evidence, new Map([[11, 'PASS']]));
  const phase11 = evidence.phaseResults.find((phase) => phase.phase === 11);
  if (phase11) phase11.details = evidence.closeout;
  await mkdir(path.dirname(harness.options.evidenceJson), { recursive: true });
  await mkdir(path.dirname(harness.options.evidenceMd), { recursive: true });
  await writeFile(harness.options.evidenceJson, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await writeFile(harness.options.evidenceMd, markdownSummary(evidence), 'utf8');
  return evidence;
}

function markdownSummary(evidence) {
  const pass = evidence.steps.filter((step) => step.status === 'PASS').length;
  const fail = evidence.steps.filter((step) => step.status === 'FAIL').length;
  const warn = evidence.steps.filter((step) => step.status === 'WARN').length;
  const skip = evidence.steps.filter((step) => step.status === 'SKIP').length;
  const observed = evidence.steps.filter((step) => step.status === 'OBSERVED').length;
  const lines = [
    `# Product/log CRUD local harness result`,
    ``,
    `- Status: ${evidence.status}`,
    `- Started: ${evidence.startedAt}`,
    `- Finished: ${evidence.finishedAt}`,
    `- Base URL: ${evidence.baseUrl}`,
    `- Namespace: ${evidence.namespace}`,
    `- Created product ID: ${evidence.createdProductId ?? 'n/a'}`,
    `- Net inventory delta after cleanup: ${evidence.netInventoryDelta}`,
    `- Git HEAD: ${evidence.provenance.gitHead}`,
    `- Git dirty: ${evidence.provenance.gitDirty} (${evidence.provenance.dirtyLineCount} porcelain lines)`,
    `- Step counts: PASS ${pass}, FAIL ${fail}, WARN ${warn}, SKIP ${skip}, OBSERVED ${observed}`,
    `- Dev verdict: ${evidence.devVerdict?.verdict ?? 'n/a'} (${evidence.devVerdict?.devStatus ?? 'n/a'})`,
    ``,
    `## Phase results`,
    ``,
    `| Phase | Status | Name |`,
    `| --- | --- | --- |`,
    ...evidence.phaseResults.map((phase) => `| ${phase.phase} | ${phase.status} | ${escapeMd(phase.name)} |`),
    ``,
    `## Users selected by role`,
    ``,
    `| Role | User ID | Email (masked) | Roles |`,
    `| --- | --- | --- | --- |`,
    ...ROLES.map((role) => {
      const user = evidence.usersByRole[role];
      return `| ${role} | ${user?.id ?? 'SKIP'} | ${maskEmail(user?.email) ?? ''} | ${user?.roles?.join(', ') ?? ''} |`;
    }),
    ``,
    `## Steps`,
    ``,
    `| Status | Step | HTTP/status summary |`,
    `| --- | --- | --- |`,
    ...evidence.steps.map((step) => {
      const details = step.details ?? {};
      const http = details.method ? `${details.method} ${details.path} -> ${details.status}${details.errorCode ? ` ${details.errorCode}` : ''}` : (details.reason ?? details.targetId ?? '');
      return `| ${step.status} | ${escapeMd(step.name)} | ${escapeMd(String(http))} |`;
    }),
  ];
  if (evidence.error) {
    lines.push('', '## Error', '', `- ${evidence.error.message}`);
  }
  lines.push('');
  return lines.join('\n');
}

function escapeMd(value) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > 2 ? '***' : '*'}@${domain}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  loadEnv();
  const startedAt = new Date().toISOString();
  const prov = provenance();
  const harness = new Harness(options);
  const prisma = new PrismaClient();
  let users = {};
  let runError = null;

  try {
    users = await selectUsersByRole(prisma);
    await harness.run(users, prisma);
  } catch (error) {
    runError = error;
  } finally {
    try {
      harness.finalCounts = await localCounts(prisma);
    } catch (countError) {
      harness.record('final local count snapshot', 'WARN', { error: serializeError(countError) });
    }
    await prisma.$disconnect();
  }

  const finishedAt = new Date().toISOString();
  const evidence = await writeEvidence(harness, startedAt, finishedAt, users, prov, runError);
  const output = {
    status: evidence.status,
    namespace: evidence.namespace,
    baseUrl: evidence.baseUrl,
    createdProductId: evidence.createdProductId,
    createdProductIds: evidence.createdProductIds,
    devVerdict: evidence.devVerdict,
    phaseStatuses: evidence.phaseResults.map((phase) => ({ phase: phase.phase, status: phase.status })),
    jsonEvidence: options.evidenceJson,
    markdownEvidence: options.evidenceMd,
    stepCounts: {
      pass: evidence.steps.filter((step) => step.status === 'PASS').length,
      fail: evidence.steps.filter((step) => step.status === 'FAIL').length,
      warn: evidence.steps.filter((step) => step.status === 'WARN').length,
      skip: evidence.steps.filter((step) => step.status === 'SKIP').length,
      observed: evidence.steps.filter((step) => step.status === 'OBSERVED').length,
    },
    error: runError ? runError.message : null,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (runError) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
