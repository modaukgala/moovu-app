import { createClient } from "@supabase/supabase-js";

export const ALLOWED_ADMIN_ROLES = ["owner", "admin", "dispatcher", "support"] as const;
type AdminRole = (typeof ALLOWED_ADMIN_ROLES)[number];

function isAllowedAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ALLOWED_ADMIN_ROLES.includes(value as AdminRole);
}

export async function requireAdminUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false as const, status: 401, error: "Missing access token." };
  }

  const supabaseUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !isAllowedAdminRole(profile?.role)) {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }

  return {
    ok: true as const,
    user,
    profile,
    supabaseAdmin,
  };
}
