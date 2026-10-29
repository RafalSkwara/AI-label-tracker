"use client";

import SuppliesApp from "@/features/supplies/SuppliesApp";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need="zapasy">{() => <SuppliesApp />}</Shell>;
}
