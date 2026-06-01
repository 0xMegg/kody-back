import type { FastifyInstance } from 'fastify';
import type { EmployeeStatus } from '@/domain/shared/types.js';
import { successResponse, ValidationError } from '../api/index.js';
import { requirePermission } from '../auth/guards.js';

interface CreateEmployeeBody {
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  joinedAt?: Date | null;
}

interface StatusBody {
  status: EmployeeStatus;
  leftAt?: Date | null;
}

export function registerAdminEmployeeRoutes(server: FastifyInstance): void {
  server.get(
    '/admin/employees',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'read' }) },
    async (_request, reply) => {
      const result = await server.services.adminEmployees.listEmployees();

      reply.status(200);
      return successResponse(result);
    },
  );

  server.post(
    '/admin/employees',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseCreateEmployeeBody(request.body);
      const result = await server.services.adminEmployees.createEmployee(body);

      reply.status(201);
      return successResponse(result);
    },
  );

  server.patch(
    '/admin/employees/:id/status',
    { preHandler: requirePermission({ resource: 'userAdmin', action: 'write' }) },
    async (request, reply) => {
      const body = parseStatusBody(request.body);
      const result = await server.services.adminEmployees.updateStatus({
        employeeId: parseEmployeeId(request.params),
        status: body.status,
        ...(body.leftAt !== undefined && { leftAt: body.leftAt }),
      });

      reply.status(200);
      return successResponse(result);
    },
  );
}

function parseEmployeeId(params: unknown): string {
  if (!isRecord(params) || typeof params.id !== 'string' || params.id.trim() === '') {
    throw new ValidationError('employee id is required');
  }

  return params.id;
}

function parseCreateEmployeeBody(body: unknown): CreateEmployeeBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { name, email, phone, department, position, joinedAt } = body;

  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required');
  }

  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('email is required');
  }

  return {
    name,
    email,
    phone: parseOptionalString(phone, 'phone'),
    department: parseOptionalString(department, 'department'),
    position: parseOptionalString(position, 'position'),
    joinedAt: parseOptionalDate(joinedAt, 'joinedAt'),
  };
}

function parseStatusBody(body: unknown): StatusBody {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object');
  }

  const { status, leftAt } = body;

  if (typeof status !== 'string' || !isEmployeeStatus(status)) {
    throw new ValidationError('status must be ACTIVE or INACTIVE');
  }

  return {
    status,
    leftAt: parseOptionalDate(leftAt, 'leftAt'),
  };
}

function parseOptionalString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  return value;
}

function parseOptionalDate(value: unknown, fieldName: string): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be an ISO date string`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be an ISO date string`);
  }

  return date;
}

function isEmployeeStatus(value: string): value is EmployeeStatus {
  return value === 'ACTIVE' || value === 'INACTIVE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
