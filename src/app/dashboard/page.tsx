"use client";

import Tracker from "@/components/Tracker";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need="dashboard">{({ email }) => <Tracker email={email} />}</Shell>;
}
