export const USER_ROLES = ["customer", "driver", "admin", "dispatcher", "support", "owner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ADMIN_ROLES = ["owner", "admin", "dispatcher", "support"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ADMIN_ROLES.includes(value as AdminRole);
}

