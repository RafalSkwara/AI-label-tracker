"use client";

import Home from "@/features/home/Home";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need={null}>{({ can }) => <Home can={can} />}</Shell>;
}
