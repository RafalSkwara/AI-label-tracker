"use client";

import { supabase } from "@/lib/supabase";

export default function NoAccess({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="login">
      <h1>Side Hustle Assistant</h1>
      {error ? (
        <div className="banner">
          <span>{error}</span>
          {onRetry && <button className="btn" onClick={onRetry}>Spróbuj ponownie</button>}
        </div>
      ) : (
        <p className="sub">Nie masz jeszcze dostępu. Poproś administratora.</p>
      )}
      <button className="linkbtn" onClick={() => supabase().auth.signOut()}>Wyloguj</button>
    </main>
  );
}
