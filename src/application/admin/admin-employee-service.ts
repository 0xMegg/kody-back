import { DomainRuleError } from '@/domain/shared/errors.js';
import type { EmployeeStatus } from '@/domain/shared/types.js';

export interface AdminEmployeeSummary {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  status: EmployeeStatus;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  hasUser: boolean;
}

export interface CreateEmployeeInput {
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  joinedAt?: Date | null;
}

export interface UpdateEmployeeStatusInput {
  employeeId: string;
  status: EmployeeStatus;
  leftAt?: Date | null;
}

interface StoredEmployee {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  position?: string | null;
  status: EmployeeStatus;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  user?: { id: string } | null;
}

interface EmployeeRepository {
  employee: {
    findMany(args: {
      include: { user: { select: { id: true } } };
      orderBy: { createdAt: 'asc' | 'desc' };
    }): Promise<StoredEmployee[]>;
    create(args: {
      data: {
        name: string;
        email: string;
        phone?: string | null;
        department?: string | null;
        position?: string | null;
        status: 'ACTIVE';
        joinedAt?: Date | null;
      };
      include: { user: { select: { id: true } } };
    }): Promise<StoredEmployee>;
    update(args: {
      where: { id: string };
      data: { status: EmployeeStatus; leftAt?: Date | null };
      include: { user: { select: { id: true } } };
    }): Promise<StoredEmployee>;
  };
}

export class AdminEmployeeService {
  constructor(private readonly repository: EmployeeRepository) {}

  async listEmployees(): Promise<AdminEmployeeSummary[]> {
    const employees = await this.repository.employee.findMany({
      include: { user: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return employees.map(toAdminEmployeeSummary);
  }

  async createEmployee(input: CreateEmployeeInput): Promise<AdminEmployeeSummary> {
    const name = input.name.trim();
    const email = normalizeEmail(input.email);

    if (name === '') {
      throw new DomainRuleError('INVALID_EMPLOYEE_NAME', 'Employee name is required', 400);
    }

    if (email === '') {
      throw new DomainRuleError('INVALID_EMPLOYEE_EMAIL', 'Employee email is required', 400);
    }

    const employee = await this.repository.employee.create({
      data: {
        name,
        email,
        phone: normalizeOptionalText(input.phone),
        department: normalizeOptionalText(input.department),
        position: normalizeOptionalText(input.position),
        status: 'ACTIVE',
        ...(input.joinedAt !== undefined && { joinedAt: input.joinedAt }),
      },
      include: { user: { select: { id: true } } },
    });

    return toAdminEmployeeSummary(employee);
  }

  async updateStatus(input: UpdateEmployeeStatusInput): Promise<AdminEmployeeSummary> {
    const employee = await this.repository.employee.update({
      where: { id: input.employeeId },
      data: {
        status: input.status,
        ...(input.leftAt !== undefined && { leftAt: input.leftAt }),
      },
      include: { user: { select: { id: true } } },
    });

    return toAdminEmployeeSummary(employee);
  }
}

function toAdminEmployeeSummary(employee: StoredEmployee): AdminEmployeeSummary {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    department: employee.department,
    position: employee.position,
    status: employee.status,
    joinedAt: employee.joinedAt,
    leftAt: employee.leftAt,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
    hasUser: employee.user !== null && employee.user !== undefined,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}
