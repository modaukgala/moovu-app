export default function CustomerProfileHeader({ name, email, phone }: { name: string; email?: string | null; phone?: string | null }) {
  const initials = (name || "Customer").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <header className="customer-profile-header"><div className="customer-profile-avatar">{initials}</div><div><span>MOOVU Customer</span><h1>{name || "Customer"}</h1><p>{phone || email || "Your MOOVU account"}</p></div></header>;
}
