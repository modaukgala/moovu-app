import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { handlePayoutMutation } from "@/lib/admin/payoutMutation";

export async function POST(request: Request) {
  return handlePayoutMutation(request, async (req) => {
    const session = await requireAdminUser(req);
    if (!session.ok) return session;
    // The privileged database client has no end-user subject. Bind it here
    // to the validated Auth user and trusted profile, never to payload data.
    return {
      ok: true,
      actor: session.user.id,
      financial: isFinancialAdminRole(session.profile.role),
      rpc: (name, args) => session.supabaseAdmin.rpc(name, args),
    };
  });
}
