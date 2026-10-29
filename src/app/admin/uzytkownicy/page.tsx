"use client";

import UsersAdmin from "@/features/admin/UsersAdmin";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need="admin">{({ userId }) => <UsersAdmin userId={userId} />}</Shell>;
}
