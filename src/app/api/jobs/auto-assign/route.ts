// Legacy compatibility shim for older clients still posting to
// /api/jobs/auto-assign. The real implementation remains admin-protected.
export { POST } from "../../admin/trips/auto-assign/route";
