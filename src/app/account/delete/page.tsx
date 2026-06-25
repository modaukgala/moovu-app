import AccountDeletionFlow from "@/components/account/AccountDeletionFlow";

export default function CustomerDeleteAccountPage() {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  return (
    <AccountDeletionFlow
      role="customer"
      apiPath="/api/customer/account/delete"
      accountPath="/account"
      loginPath="/customer/auth?next=/account/delete"
      homePath="/"
    />
  );
}
