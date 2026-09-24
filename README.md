# Smart Sketcher Web

Statyczna aplikacja do przygotowania obrazu i wysłania go przez Web Bluetooth do smART Sketcher 2.0. Kod działa w przeglądarce bez backendu. Użytkownik potwierdził działanie połączenia i wysyłania na swoim projektorze; inne egzemplarze i adaptery mogą wymagać sprawdzenia (`requires hardware verification`).

## Użycie

1. Otwórz stronę w aktualnym Chrome lub Edge przez HTTPS albo `localhost`.
2. Włącz smART Sketcher 2.0 i Bluetooth w komputerze.
3. Kliknij **Połącz ze smART Sketcher** i wybierz urządzenie.
4. Wybierz lub przeciągnij obraz PNG, JPG, WEBP albo BMP.
5. Wybierz **Dopasuj** (cały obraz i białe marginesy) lub **Wypełnij** (środkowe przycięcie). Ustaw skalę od 50% do 300% i obracaj obraz przyciskami o 90° w lewo lub w prawo.
6. Sprawdź końcowy podgląd i kliknij **Wyślij do projektora**. Przycisk **Resetuj** przywraca skalę 100% i obrót 0°.

Plik obrazu jest przetwarzany lokalnie w przeglądarce. Aplikacja nie przesyła go na serwer. Skalowanie i obrót zmieniają dokładnie ten sam obraz 160 × 128 RGB565, który jest pokazywany w podglądzie i wysyłany do projektora. Skala działa względem wybranego trybu Dopasuj/Wypełnij; przy zmniejszeniu mogą pojawić się białe marginesy. PWA można zainstalować z menu Chrome/Edge; działa nadal w przeglądarkowym runtime i wymaga dostępnego Bluetooth.

## Analiza projektu źródłowego

Podstawa: [`sketcher.py`](https://github.com/megakode/smart-sketcher-tools/blob/main/sketcher.py), [`requirements.txt`](https://github.com/megakode/smart-sketcher-tools/blob/main/requirements.txt) oraz [opis protokołu w README](https://github.com/megakode/smart-sketcher-tools/blob/main/README.md).

| Element | Ustalenie |
| --- | --- |
| Wykrywanie | `BleakScanner.discover()` i ścisłe porównanie nazwy `smART_sketcher2.0`; opcjonalnie adres BLE z argumentu. |
| Charakterystyka | `0000ffe3-0000-1000-8000-00805f9b34fb`, ta sama dla zapisu i powiadomień. |
| Usługa GATT | **Nie została podana** w źródłowym repozytorium. |
| Komenda | `01 00 00 00 50 00 01 00` przed obrazem. Parametry `0x50` i `0x01` nie są w pełni wyjaśnione w opisie źródłowym. |
| Obraz | 160 × 128, wiersze poziome po 320 bajtów, RGB565 `RRRRRGGG GGGBBBBB`; najstarszy bajt piksela przed młodszym. |
| Przepływ | Źródłowy README mówi o `OK` po każdej linii; wspomina też o czterech pakietach naraz. `sketcher.py` ignoruje odpowiedzi i odczekuje 50 ms przed każdą linią. |
| Odpowiedzi | ASCII przez powiadomienia, możliwe `OKOK`; odpowiedź komendy może mieć postać `OK_01`. |
| Zależności starej wersji | `asyncclick`, `anyio`, `progress`, `pillow`, `bleak`. Nowa aplikacja ich nie potrzebuje. |

W `sketcher.py` drugi bajt RGB565 to `(g & 0x1c) << 3 | (g >> 3)`. Korzysta dwa razy z zieleni i pomija niebieski, a dolne bity zieleni też nie są składane poprawnie. Prawidłowa wartość to `((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)`, następnie bajt starszy i młodszy. Stare `resize(160, 128)` rozciąga obraz niezależnie od proporcji. Samo ustawienie stanu na `1` dla każdego powiadomienia nie rozróżnia `OK`, `OKOK` ani błędów. Niejednoznaczny pozostaje też opis „4 packets at a time” wobec 320-bajtowych zapisów w Pythonie. Każdy z tych punktów transmisji jest `requires hardware verification`.

## Migracja i architektura

`Pillow` zastępuje Canvas, a `Bleak` zastępuje Web Bluetooth. `js/imageProcessor.js` dekoduje, kadruje, kwantyzuje podgląd i koduje RGB565. `js/protocol.js` buduje komendę i wysyła wiersze po kolei. `js/bluetooth.js` wyszukuje urządzenie, otwiera GATT, obsługuje powiadomienia i serializuje zapisy. `js/app.js` obsługuje formularz, stany i postęp. Wszystkie parametry są w `js/config.js`.

Domyślna usługa `0000ffe0-0000-1000-8000-00805f9b34fb` jest **hipotezą**, wybraną jako tymczasowa konfiguracja dla charakterystyki FFE3. Nie pochodzi z repozytorium źródłowego. Można ją zmienić w **Ustawieniach połączenia** przed kliknięciem przycisku łączenia. Web Bluetooth wymaga zadeklarowania usługi w `optionalServices` już w momencie wyboru urządzenia; znajomość samej charakterystyki nie wystarcza. [Dokumentacja Chrome](https://developer.chrome.com/docs/capabilities/bluetooth) opisuje ten wymóg.

### Jak ustalić UUID usługi

1. Włącz projektor i rozłącz go z innymi aplikacjami.
2. W Chrome/Edge otwórz `chrome://bluetooth-internals` lub `edge://bluetooth-internals`, wybierz kartę **Devices**, odszukaj `smART_sketcher2.0` i połącz się. Ewentualnie użyj skanera GATT, np. nRF Connect na telefonie.
3. Rozwiń usługi GATT. Odszukaj charakterystykę `0000ffe3-0000-1000-8000-00805f9b34fb` i zapisz UUID **jej usługi nadrzędnej**. Nie myl UUID usługi z UUID charakterystyki.
4. Wpisz UUID usługi w ustawieniach strony i połącz ponownie. Jeśli wynik jest stały dla tego modelu, ustaw go w `js/config.js` jako `DEFAULT_SERVICE_UUID`.

Odczyt usług w `bluetooth-internals` zależy od wersji przeglądarki i platformy. Chrome opisuje ten panel w [przewodniku Web Bluetooth](https://developer.chrome.com/articles/bluetooth).

### Transmisja i ograniczenia

Każdy wiersz ma 320 bajtów. Domyślnie aplikacja wykonuje **jeden zapis charakterystyki na całą linię**, tak jak `sketcher.py`, z odstępem 50 ms przed każdą linią. Używa zapisu z odpowiedzią, jeśli charakterystyka go oferuje, inaczej zapisu bez odpowiedzi. Powiadomienia są wyświetlane diagnostycznie w ustawieniach, lecz nie blokują kolejnych linii: w pierwszej wersji użytkownik zobaczył przerywane linie oraz timeout przy domyślnym dzieleniu na 20-bajtowe zapisy i oczekiwaniu na `OK`. `writeValueWithResponse()` potwierdza zapis GATT, nie poprawne wyświetlenie linii przez projektor ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/writeValueWithResponse)).

Jeśli przeglądarka odrzuca zapis 320 B, w **Ustawieniach połączenia i transmisji** można wybrać 80 B albo 20 B. Te warianty są eksperymentalne: Web Bluetooth nie udostępnia przenośnego API do odczytu uzgodnionego ATT MTU, a mniejsze osobne zapisy mogą być interpretowane przez projektor inaczej niż jeden zapis linii. Stosowany jest odstęp 5 ms między fragmentami. Nie wznawiamy przerwanej linii, ponieważ protokół nie podaje bezpiecznego sposobu ponowienia. Wielkość zapisu, dokładna semantyka `OK` i czasy wymagane przez adapter pozostają `requires hardware verification`.

### Gdy obraz ma poziome przerwy

1. Otwórz [adres z numerem wersji](https://codekexplor.github.io/-Web-smART-Sketcher-2.0-/?v=20260924-4). Na dole strony musi być napis **Wersja 2026.09.24.4**. Zamknij wcześniej otwartą kartę lub zainstalowaną PWA. Zasoby JS/CSS mają numer wersji w adresie, a service worker pobiera aktualną wersję z sieci.
2. Użyj domyślnej opcji **Cała linia · 320 B**.
3. Wyślij prosty obraz testowy i porównaj go z podglądem. Postęp oznacza zakończone zapisy GATT, a nie potwierdzenie wyglądu obrazu.
4. Jeśli wystąpi błąd zapisu 320 B, przetestuj 80 B, a dopiero potem 20 B. Zapisz rozmiar zapisu, przeglądarkę, system, linię/procent błędu i ostatnią odpowiedź BLE. Te dane pomogą dobrać poprawny sposób transmisji dla Twojego egzemplarza.

## Development

Testy jednostkowe i mock BLE wymagają tylko Node.js do uruchomienia lokalnego; Node.js nie jest backendem aplikacji:

```sh
node --test tests/*.test.js
node --check js/app.js
```

Do testu strony użyj prostego lokalnego serwera statycznego, np. `python -m http.server 8000`, a następnie otwórz `http://localhost:8000`. Python jest tu wyłącznie opcjonalnym serwerem plików dla developmentu. Możesz użyć dowolnego serwera statycznego. Nie otwieraj strony przez `file://`; moduły ES i service worker wymagają serwowania przez HTTP(S).

## GitHub Pages

Strona jest opublikowana pod adresem **https://codekexplor.github.io/-Web-smART-Sketcher-2.0-/**. GitHub Pages pobiera pliki z gałęzi `main`, z katalogu `/ (root)`. Po wypchnięciu zmian do `main` GitHub publikuje nową wersję automatycznie. Ścieżki aplikacji są względne i działają w podkatalogu projektu.

Przy kolejnej zmianie plików aplikacji należy zwiększyć numer wersji w `index.html`, `manifest.webmanifest`, importach modułów JS oraz `service-worker.js`. GitHub Pages wysyła pliki z nagłówkiem cache, więc pozwala to przeglądarce pobrać spójny zestaw nowych plików.

Web Bluetooth wymaga bezpiecznego kontekstu: HTTPS albo `localhost` ([Chrome](https://developer.chrome.com/docs/capabilities/bluetooth)). Dostępność na konkretnym systemie i w konkretnej przeglądarce trzeba sprawdzić lokalnie.

## Checklista testu na prawdziwym projektorze

Każdy punkt poniżej to `requires hardware verification`:

- [ ] Potwierdź nazwę urządzenia w oknie wyboru i UUID usługi nadrzędnej dla FFE3.
- [ ] Potwierdź właściwości FFE3: zapis z odpowiedzią lub bez odpowiedzi oraz notifications.
- [ ] Połącz, rozłącz ręcznie i połącz ponownie; sprawdź zachowanie po wyłączeniu projektora w trakcie transferu.
- [ ] Wyślij wzorzec pięciu kolorów: czarny, biały, czerwony, zielony, niebieski; porównaj barwy i kolejność bajtów.
- [ ] Wyślij obraz z odmiennymi kolorami po lewej i prawej oraz numerami wierszy, by sprawdzić kolejność i brak przesunięć.
- [ ] Porównaj tryby **Dopasuj** i **Wypełnij** z podglądem 160 × 128.
- [ ] Zapisz powiadomienia dla komendy, każdej linii i końca obrazu; sprawdź `OK`, `OKOK` i ewentualne `OK_01`.
- [ ] Porównaj jeden zapis 320 B na linię z wariantami 80 B i 20 B; sprawdź, czy projektor nie traktuje fragmentów jako oddzielnych linii.
- [ ] Przetestuj timeout, brak usługi, brak charakterystyki i błąd zapisu na co najmniej dwóch adapterach Bluetooth.
- [ ] Przetestuj instalację PWA oraz połączenie z uruchomionej aplikacji w Chrome i Edge na Windows.
