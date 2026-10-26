import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prywatność · Privacy",
  description: "Polityka prywatności aplikacji osobistej / Privacy policy of a personal single-user app",
};

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Polityka prywatności</h1>
      <section lang="pl">
        <p>To prywatna aplikacja jednego użytkownika (jej właściciela), służąca do śledzenia własnych projektów muzycznych i kanałów YouTube. Nie jest usługą dla innych osób.</p>
        <ul>
          <li>Aplikacja prosi o dostęp tylko do odczytu danych YouTube: <code>youtube.readonly</code> i <code>yt-analytics.readonly</code>. Niczego nie publikuje, nie zmienia ani nie usuwa na kanale.</li>
          <li>Pobiera statystyki własnego kanału (wyświetlenia, czas oglądania, subskrypcje, wyświetlenia miniatur i CTR) i zapisuje je w bazie właściciela.</li>
          <li>Tokeny dostępu są przechowywane wyłącznie po stronie serwera i nigdy nie trafiają do przeglądarki.</li>
          <li>Dane nie są sprzedawane, udostępniane ani przekazywane osobom trzecim.</li>
          <li>Dostęp można w każdej chwili cofnąć na stronie <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> (Konto Google → Bezpieczeństwo → Aplikacje i usługi innych firm). Po cofnięciu aplikacja nie ma już dostępu do kanału.</li>
        </ul>
      </section>
      <hr />
      <h1 lang="en">Privacy policy</h1>
      <section lang="en">
        <p>This is a personal, single-user app used by its owner to track their own music projects and YouTube channels. It is not a service for other people.</p>
        <ul>
          <li>The app requests read-only access to YouTube data: <code>youtube.readonly</code> and <code>yt-analytics.readonly</code>. It never publishes, edits or deletes anything on the channel.</li>
          <li>It reads the channel&apos;s own statistics (views, watch time, subscribers, thumbnail impressions and CTR) and stores them in the owner&apos;s database.</li>
          <li>Access tokens are stored server-side only and are never sent to the browser.</li>
          <li>Data is not sold, shared with or passed to any third party.</li>
          <li>Access can be revoked at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> (Google Account → Security → Third-party apps and services). After revoking, the app can no longer reach the channel.</li>
        </ul>
      </section>
    </main>
  );
}
