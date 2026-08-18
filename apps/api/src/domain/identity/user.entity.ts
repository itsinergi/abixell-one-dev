export interface User {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPasswordHash extends User {
  passwordHash: string;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  fullName: string;
  passwordHash: string;
}

export interface UserRepository {
  create(input: CreateUserInput, createdBy: string | null): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmailInTenant(tenantId: string, email: string): Promise<UserWithPasswordHash | null>;
  listByTenant(tenantId: string): Promise<User[]>;
}
