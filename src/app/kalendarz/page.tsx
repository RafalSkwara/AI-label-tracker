"use client";

import CalendarApp from "@/features/calendar/CalendarApp";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need={null}>{({ userId, email, can }) => <CalendarApp userId={userId} email={email} dashboard={can("dashboard")} />}</Shell>;
}
