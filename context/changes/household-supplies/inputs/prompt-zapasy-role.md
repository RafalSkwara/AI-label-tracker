# Zadanie: role użytkowników i moduł „Zapasy domowe” w Side Hustler Assistant

## Kontekst
Pracujemy na **istniejącym, działającym produkcie Side Hustler Assistant**, który znasz. Nie budujemy nowej aplikacji. Dodajemy do niej **jedną nową zakładkę w głównej nawigacji: „Zapasy”**.

Zakładka „Zapasy” jest **całkowicie niezależna** od reszty produktu:
- ma własne trasy, komponenty, stan i tabele w bazie;
- nie korzysta z danych dashboardu (YouTube, AI eksperyment i innych sekcji) i ich nie zmienia;
- dzieli z produktem tylko to, co wspólne z definicji: logowanie, layout z nawigacją, design system i projekt Supabase.

Usunięcie tej zakładki w przyszłości ma być proste i nie może niczego zepsuć w reszcie produktu.

## Cel
Chcę udostępniać wybrane części produktu innym osobom (np. żonie). Potrzebuję:
1. **Zakładki „Zapasy”**: wspólnej, w pełni edytowalnej listy zakupów kryzysowych dla domu, podzielonej na własne podzakładki, którą kilka osób edytuje jednocześnie.
2. **Systemu ról**, żeby żona widziała tylko „Zapasy”, a obecny dashboard pozostał dostępny tylko dla mnie i osób, którym go nadam.

Używamy **obecnego projektu Supabase** produktu. Nie mam wolnego miejsca na nowy projekt.

## Krok 0: co sprawdzić przed zmianami
Produkt znasz, więc nie rób pełnego rozpoznania. Sprawdź tylko to, co dotyczy tego zadania:
- jak dziś działa logowanie i czy jest już coś w rodzaju ról lub uprawnień, na czym da się zbudować;
- czy dane dashboardu są przypisane do `user_id` właściciela, czy są globalne. Od tego zależy, jak druga osoba z rolą `dashboard` miałaby je widzieć. Zaproponuj rozwiązanie w planie;
- jak dodać pozycję do nawigacji i nowe trasy zgodnie z obecnymi wzorcami w kodzie.

Jeśli coś różni się od założeń poniżej, dostosuj się do produktu i zapisz decyzję. Pytaj tylko o rzeczy, które naprawdę blokują pracę.

## 1. Role i uprawnienia
**Model:** użytkownik może mieć kilka ról jednocześnie.

| Rola | Dostęp |
|---|---|
| `admin` | Wszystko oraz panel użytkowników: zapraszanie, nadawanie i odbieranie ról |
| `dashboard` | Obecny dashboard: YouTube, AI eksperyment i inne istniejące sekcje |
| `zapasy` | Tylko moduł Zapasy |

**Baza:**
- Typ wyliczeniowy `app_role` i tabela `user_roles (user_id, role, granted_by, granted_at)` z unikalną parą `(user_id, role)`.
- Funkcja `has_role(role)` typu `SECURITY DEFINER` z ustawionym `search_path`, używana w politykach RLS. Rola `admin` przechodzi każdą kontrolę.
- Nadawanie i odbieranie ról tylko przez admina. Wymuś to w bazie (RLS lub RPC), a nie tylko w interfejsie.
- **Zawsze musi zostać co najmniej jeden admin.** Odebranie ostatniej roli `admin` ma być odrzucone przez bazę.
- Pierwszy admin to moje obecne konto (`<MÓJ_EMAIL>`), nadany w migracji lub seedzie. Mojego e-maila nie zapisuj w kodzie frontendu.
- Obecne tabele dashboardu objęte RLS: dostęp tylko z `dashboard` lub `admin`. Bez utraty i przenoszenia danych. Nie usuwaj istniejących polityk bez opisu w planie.

**Aplikacja:**
- Osoba zalogowana bez żadnej roli widzi ekran „Nie masz jeszcze dostępu. Poproś administratora.”
- Nawigacja pokazuje tylko sekcje, do których użytkownik ma prawo. Trasy są chronione także po stronie serwera (middleware lub loader), nie tylko ukryte w menu.
- **Panel admina** (np. `/admin/uzytkownicy`):
  - lista użytkowników z rolami do zaznaczania;
  - zaproszenie mailem: e-mail i wybrane role. Użyj zaproszenia lub magic linku z Supabase Auth, wywoływanego po stronie serwera. Klucz `service_role` nigdy nie trafia do przeglądarki. Role nadane zaproszonemu e-mailowi przypisz przy jego pierwszym logowaniu, np. przez tabelę `pending_invites`;
  - odebranie dostępu.

## 2. Zakładka „Zapasy” (`/zapasy`)
Nowa pozycja w głównej nawigacji istniejącego produktu, niezależna od reszty, jak opisano w sekcji „Kontekst”. Wygląda spójnie z resztą produktu, bo używa jego design systemu i layoutu. Tabele mają prefiks `supply_`. Jedna wspólna lista dla całego domu: każdy z rolą `zapasy` lub `admin` widzi i edytuje to samo.

Wewnątrz zakładki „Zapasy” są **podzakładki** listy (np. „A: niezbędne”, „B: droższe”). To zupełnie inna rzecz niż zakładki w głównej nawigacji produktu.

**Lista ma być w pełni edytowalna przez użytkownika.** Nic w niej nie jest zaszyte w kodzie: podzakładki, kategorie, produkty, nazwy, ceny i szczegóły pochodzą z bazy i każdy z rolą `zapasy` lub `admin` może je zmieniać.

**Tabele:**
- `supply_tabs`: `id`, `name` (np. „A: niezbędne”), `description`, `sort_order`, `archived`, `created_by`, `created_at`, `updated_at`. To podzakładki listy.
- `supply_items`: `id`, `key` (unikalny, potrzebny do seeda), `tab_id` (FK do `supply_tabs`), `category`, `name`, `quantity`, `details` (dłuższa notatka, np. gdzie kupić, model, link), `price_min`, `price_max`, `price_label` (np. „wg recepty”), `own_price`, `checked`, `checked_by`, `checked_at`, `removed`, `sort_order`, `created_by`, `created_at`, `updated_at`.
- Kategoria to na start pole tekstowe z podpowiedziami z już używanych wartości w danej podzakładce. Osobną tabelę kategorii dodaj tylko, jeśli uznasz to za prostsze.
- RLS na obu tabelach: odczyt i zapis dla `has_role('zapasy')` lub `has_role('admin')`.

**Podzakładki:**
- Na górze pasek podzakładek: **„Wszystko”** oraz każda podzakładka z `supply_tabs`. Na start z seeda: „A: niezbędne” i „B: droższe”.
- Dodawanie nowej podzakładki, zmiana jej nazwy i opisu, zmiana kolejności oraz archiwizacja. Archiwizacja podzakładki z pozycjami wymaga potwierdzenia w interfejsie, a jej pozycje wracają razem z nią po przywróceniu.
- Widok „Wszystko” pokazuje pozycje ze wszystkich aktywnych podzakładek, pogrupowane po podzakładce, a w niej po kategorii.

**Produkty, wszystko edytowalne w miejscu lub w prostym panelu edycji:**
- Dodawanie nowego produktu: nazwa, podzakładka, kategoria, ilość, szczegóły, cena szacunkowa (od–do albo jedna kwota) lub własna cena.
- Edycja każdego pola istniejącego produktu: nazwa, ilość, szczegóły, kategoria, cena szacunkowa, własna cena, a także przeniesienie do innej podzakładki.
- **Edycja ceny:** kliknięcie kwoty pozwala wpisać własną cenę, która zastępuje szacunek. Wyczyszczenie pola przywraca przedział szacunkowy.
- Odhaczanie kupionych rzeczy. Przy pozycji widać, kto ją odhaczył (inicjał wystarczy).
- **Usuwanie** (miękkie, przez `removed = true`) i sekcja „Usunięte z listy” z przywracaniem jednym kliknięciem.
- Zmiana kolejności pozycji w kategorii (przeciąganie albo strzałki góra/dół; na telefonie strzałki wystarczą).

**Filtrowanie, zawsze w obrębie bieżącej podzakładki albo widoku „Wszystko”:**
- przełącznik „Ukryj kupione”;
- wyszukiwanie po nazwie i szczegółach;
- filtr po kategorii.

**Podsumowanie** na przyklejonym pasku, liczone dla bieżącej podzakładki, a w widoku „Wszystko” dla całości: kupione X/Y, wydane i zostało. Gdy pozycja nie ma własnej ceny, kwoty pokazuj jako przedziały. Pomijaj pozycje usunięte i te bez ceny. W widoku „Wszystko” pokaż też sumy dla każdej podzakładki osobno.
- **Realtime:** zmiana zrobiona przez jedną osobę pojawia się u drugiej bez odświeżania, przez Supabase Realtime.
- **Mobile-first:** lista będzie używana w sklepie na telefonie, więc pola dotyku muszą być duże. Ma działać w trybie jasnym i ciemnym.

**Seed:** zaimportuj załączony plik `zapasy-seed.json`. Ma 70 pozycji, z czego 51 aktywnych. Pole `tier` z pliku mapuj na podzakładki: `A` na „A: niezbędne”, `B` na „B: droższe”. Pole `quantity` trafia do `quantity`, a `details` zostaw puste. Zachowaj `own_price`, `checked`, `removed` i `sort_order`. Import ma być idempotentny, z upsertem po `key`. Seed uruchamia się raz i nie nadpisuje późniejszych zmian użytkownika.

## 3. Poza zakresem
Wiele gospodarstw domowych, powiadomienia, eksport do pliku, płatności.

## 4. Kryteria akceptacji
- [ ] Użytkownik tylko z rolą `zapasy` nie dostanie się do dashboardu: nie ma go w menu, bezpośredni URL nie działa, a zapytanie do tabel dashboardu z jego sesji zwraca pusty wynik lub błąd.
- [ ] Użytkownik tylko z rolą `dashboard` nie dostanie się do Zapasów w żaden z powyższych sposobów.
- [ ] Admin nadaje i odbiera role w panelu, a zmiana działa najpóźniej po odświeżeniu sesji.
- [ ] Nie da się odebrać roli ostatniemu adminowi, także przez bezpośrednie zapytanie do bazy.
- [ ] Zaproszona osoba po pierwszym logowaniu ma dokładnie te role, które nadano w zaproszeniu.
- [ ] Dwie przeglądarki z dwoma kontami: odhaczenie w jednej pojawia się w drugiej w ciągu około 2 sekund.
- [ ] Po seedzie lista ma 2 podzakładki, 51 aktywnych i 19 usuniętych pozycji, a sumy zgadzają się z ręcznym przeliczeniem.
- [ ] Użytkownik z rolą `zapasy` dodaje nową podzakładkę, dodaje do niej produkt, zmienia mu nazwę, szczegóły, ilość i cenę oraz przenosi go do innej podzakładki, a druga osoba widzi każdą zmianę na żywo.
- [ ] Filtry i podsumowanie działają osobno w każdej podzakładce i łącznie w widoku „Wszystko”.
- [ ] Obecny dashboard działa dla admina tak samo jak przed zmianą, a istniejące testy przechodzą.
- [ ] Kod zakładki „Zapasy” nie importuje niczego z modułów dashboardu, a dashboard nie importuje niczego z „Zapasów”.
- [ ] Testy: RLS dla każdej roli (dostęp i brak dostępu), testy jednostkowe sumowania cen, test e2e logowania i ochrony tras.

## 5. Sposób pracy
- Najpierw plan: wyniki rozpoznania, decyzje i ewentualne pytania blokujące. Dopiero potem implementacja.
- Migracje mają być odwracalne lub mieć opisany sposób wycofania. Bez sekretów w repozytorium.
- Pracuj na osobnej gałęzi i rób małe commity dla każdej fazy: role, panel admina, moduł Zapasy, seed, testy.
