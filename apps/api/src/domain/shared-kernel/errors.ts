export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Thrown by the RBAC service when a user lacks permission or Data Scope
 * coverage for the action they attempted. Always maps to HTTP 403 —
 * enforcement happens here, in the application layer, not by the frontend
 * hiding a button. */
export class ForbiddenError extends Error {
  constructor(message = "Not authorized to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
