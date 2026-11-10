"use client";

import ShoppingApp from "@/features/shopping/ShoppingApp";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need={null}>{() => <ShoppingApp />}</Shell>;
}
