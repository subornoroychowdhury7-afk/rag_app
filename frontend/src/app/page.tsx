"use client";

import { useState } from "react";
import Chat from "@/components/Chat";
import Sidebar, { type Doc } from "@/components/Sidebar";

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([]);

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <Sidebar docs={docs} onUploaded={(d) => setDocs((prev) => [...prev.filter((x) => x.name !== d.name), d])} />
      <Chat hasDocs={docs.length > 0} />
    </main>
  );
}
