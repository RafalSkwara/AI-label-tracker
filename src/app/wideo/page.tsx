"use client";

import VideoApp from "@/features/video/VideoApp";
import Shell from "@/shell/Shell";

export default function Page() {
  return <Shell need="dashboard">{() => <VideoApp />}</Shell>;
}
