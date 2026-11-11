"use client";

import ExpensesApp from "@/features/expenses/ExpensesApp";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need={null}>{({ userId, email }) => <ExpensesApp userId={userId} email={email} />}</Shell>;
}
