import AccountDeletionFlow from "@/components/account/AccountDeletionFlow";

export default function DriverDeleteAccountPage() {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  return (
    <AccountDeletionFlow
      role="driver"
      apiPath="/api/driver/account/delete"
      accountPath="/driver/account"
      loginPath="/driver/login?next=/driver/account/delete"
      homePath="/driver/login"
    />
  );
}
