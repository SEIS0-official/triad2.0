# Backlog: errori e verifiche

Questo file raccoglie i problemi confermati e le verifiche ancora da fare sul progetto.
Una verifica aperta **non** implica che il codice sia errato: registrare un bug solo dopo
averlo riprodotto, indicando il comando o i passaggi, il risultato atteso e quello ottenuto.

## Mappa del progetto

La mappa è stata ricostruita con Graphify sul commit `98e3fdb` (indice del 23 ottobre 2026):
648 nodi, 1.497 relazioni e 21 comunità.

- `syntax.jl`: lexer, parser Pratt e costruzione degli alberi `Node`; tra i nodi mappati:
  `parse_toplevel`, `parse_stmt`, `parse_function`, `parse_list`, `parse_args` e `parse_for`.
- `triad.jl`: runtime ed esecuzione; Graphify individua, tra gli altri, `run_source`,
  `load_file!`, `define_function`, `define_struct`, `solve_opts` e `reload!`.
- `test/runtests.jl` e `conformance/`: test dell'implementazione e casi di conformità.
  `test/oracles/oracle_tests.jl` contiene test oracle opzionali.
- `.github/workflows/ci.yml`, `seed/` e `seed/dev/`: verifiche CI, seed Windows/Linux
  e relativi generatori.
- `bin/`: launcher e packaging standalone (`bin/build_standalone.jl`).
- `editors/`: integrazioni per gli editor; `ai/`: strumenti e benchmark.
- `SPEC.md`, `SPEC-CORE.md`, `BOOTSTRAP.md`, `STATUS.md`, `README.md` e
  `TUTORIAL.md`: standard, profilo Core, piano di bootstrap, stato e documentazione.

Graphify descrive relazioni e simboli indicizzati; non certifica la correttezza semantica,
la copertura dei test o l'assenza di bug. Le verifiche seguenti vanno quindi confermate
eseguendo codice e test e confrontandoli con la specifica.

## Problema confermato

- [x] **Workflow CI: nome del passo YAML con `:`** — Corretto in
  `.github/workflows/ci.yml` racchiudendo il valore `name` tra virgolette. Il parser YAML
  interpretava i due punti come sintassi della mappa. `git diff --check` è passato;
  la validazione con un parser YAML locale non era disponibile.
- [x] **Interpolazione di stringhe: delimitazione e posizioni** — Corretto in `syntax.jl`.
  Il parser chiudeva `$()` alla prima parentesi `)` anche quando era dentro una stringa
  dell'espressione interpolata, e non aggiornava righe/colonne per diagnostica e istruzioni
  successive. Aggiunti test di regressione per parentesi in stringhe interpolate, espressioni
  multilinea e posizioni degli errori.
- [x] **Range con spazi non conformi** — Corretto in `syntax.jl`: `a: b` veniva accettato
  nonostante la grammatica normativa richieda il range `a:b` senza spazi. Aggiunto un test
  che richiede un errore di sintassi per `1: 2`.
- [x] **Campi duplicati nelle `struct`** — Corretto in `triad.jl`: una definizione con nomi
  di campo duplicati arrivava al costruttore, che restituiva un errore host. La definizione
  ora restituisce subito `Err(:type)` con il nome del campo; aggiunto test di regressione.
- [x] **Budget delle query logiche annidate** — Corretto in `triad.jl`: i passi delle
  sotto-query `not(...)` non erano sommati al limite della query chiamante. Ora il contatore
  è condiviso; test di regressione sui limiti 5/6. Verificati anche i confini di `depth`
  con test espliciti e il caso ricorsivo esistente.
- [x] **Traccia delle sotto-query `not(...)`** — Corretto in `triad.jl`: la query interna
  non riceveva il collector della traccia e i suoi eventi `:call`/`:exit`/`:fail` mancavano.
  Aggiunti test per sotto-query riuscite e fallite.
- [x] **Launcher Windows** — `triad.cmd` poteva selezionare il falso eseguibile di Julia
  in `WindowsApps`, lasciando il comando bloccato; l'espansione ritardata poteva inoltre
  alterare argomenti contenenti `!`. Ora salta l'alias, preserva gli argomenti e propaga
  il codice d'uscita dopo l'esecuzione. Verificati rilevamento automatico, `-v` e inoltro
  di `bang!arg`.

## Verifiche da eseguire

### Parser e semantica

- [ ] **Lexer, parser e AST** — Coperti dalla suite i token e le forme principali, precedenza,
  associatività, delimitatori, stringhe/interpolazione, commenti, errori e posizioni
  (`julia --startup-file=no test/runtests.jl`: 261 test passati). Resta da completare la
  matrice requisito per requisito contro `SPEC.md` e i casi limite non ancora mappati.
- [x] **Valutazione e scope** — Verificati assegnamento locale senza alterare i globali,
  cattura e mutazione di variabili nelle closure, e visibilità locale del binding del ciclo.
  Aggiunti test di regressione in `test/runtests.jl`; suite (251 test) e conformità Core
  passano.
- [x] **Funzioni e dispatch** — Verificati metodi più specifici, ambiguità, fallback builtin,
  mismatch di tipo e sostituzione di una firma ridefinita. Aggiunto test per la sostituzione;
  suite (252 test) e conformità già eseguita passano.
- [x] **Tipi e strutture** — Verificati campi tipizzati e non tipizzati, conversione
  Int→Float, tipi mancanti, accesso a campi inesistenti, firme e vincoli dei valori. Corretto
  anche il caso dei campi duplicati; suite (253 test) e conformità completa passano.
- [x] **Chiusure e funzioni di ordine superiore** — Verificati cattura di parametri e mutazione
  di variabili catturate da funzioni annidate; la suite copre anche `map`, `filter` e `reduce`.
- [x] **Programmazione logica** — Verificati fatti, regole, unificazione/occurs-check,
  backtracking, query e opzioni di limite/profondità/passi; corretto il budget aggregato
  delle sotto-query. Suite (259 test) e conformità Core passano.
- [x] **Codice come dato e macro** — Verificati quasiquote/unquote annidati, valutazione
  del codice generato, argomenti di macro come AST, espansione e `gensym`; probe con
  unquote in liste annidate restituisce il risultato atteso.
- [x] **Errori, contratti ed effetti** — Verificati conversione delle eccezioni host,
  propagazione/intercettazione in `try`, dati degli `Err`, `requires`/`ensures`, purezza dei
  contratti e controllo dinamico di `io`/`state`; test dedicati e suite passano.
- [x] **Budget e tracce** — Verificati esaurimento e annidamento dei budget, confini di
  `depth`, trace di funzioni, risoluzione e sotto-query negated. Corretto il conteggio dei
  passi e la propagazione della traccia; suite (261 test) e conformità completa passano.

### Test e conformità

- [x] **Suite completa** — `julia --startup-file=no test/runtests.jl` passa (261 test);
  `julia --startup-file=no conformance/run.jl` passa tutti i casi.
- [x] **Profilo Triad-Core** — `julia --startup-file=no conformance/run.jl --cases
  conformance/core/cases` passa tutti i casi.
- [ ] **Copertura dei requisiti** — Collegare ogni requisito normativo di `SPEC.md` e
  `SPEC-CORE.md` a uno o più test; creare casi minimi per i requisiti non coperti. I riepiloghi
  delle suite sono verdi, ma non esiste ancora una matrice di tracciabilità completa.
- [ ] **Oracle opzionali** — `julia --startup-file=no test/oracles/oracle_tests.jl` termina
  correttamente, ma in questo ambiente tutti e tre i testset sono `saltato`: non sono
  disponibili SWI-Prolog, SBCL né l'interprete esterno usato dal test Julia. Installare i
  runtime oracle ed eseguire nuovamente per verificare i confronti effettivi.

### CLI, piattaforme e distribuzione

- [x] **CLI e caricamento file** — Verificati opzioni, valutazione, codici di uscita,
  `ARGS`, shebang, risoluzione file, errori e REPL nei test dell'implementazione e nella
  conformità.
- [x] **Launcher POSIX** — Verificati sintassi (`sh -n`), override `TRIAD_JULIA`, invocazione
  tramite `PATH`, inoltro di argomenti con spazi e `!`, shebang e codice 1 per file mancante.
  Aggiunto `test/launcher_posix.sh` ed esecuzione nella lane Linux della CI. Corretto anche il
  mode bit di `bin/triad` da `100644` a `100755`, necessario per invocarlo direttamente.
- [x] **Launcher Windows** — Verificati ricerca PATH contro l'alias `WindowsApps`, override
  `TRIAD_JULIA`, modalità `-v` e inoltro di argomenti contenenti `!` attraverso
  `bin/triad.cmd`.
- [x] **Seed Linux e Windows** — Entrambi i generatori riproducono i dump esadecimali con
  gli hash documentati (`11ad…289c` Windows, `ad4c…a5ea` Linux). L'ELF Linux ricostruito
  stampa `Triad seed Linux OK` e ha SHA-256 `6d504451…a7797f9`. Il PE Windows ricostruito
  passa 26/26 casi Core via Wine con stdout byte-per-byte ed exit code corretti. La CI
  Windows hosted e il comportamento di Defender restano da verificare separatamente.
- [ ] **CI Windows** — Verificare che decodifica, esclusione antivirus facoltativa e casi
  del seed funzionino anche quando l'esclusione non è disponibile; chiarire quali errori
  sono tollerati da `continue-on-error`. Nel workflow il flag si applica solo al passo
  `Add-MpPreference`: decodifica, casi e hash restano bloccanti. In locale Defender ha
  quarantinato il PE non escluso; la lane Windows hosted va quindi verificata senza
  presumere che l'esclusione riesca.
- [ ] **CI multipiattaforma** — Verificate localmente le suite Julia Full/Core e 26 casi
  seed Windows via Wine; workflow ispezionato e smoke test launcher aggiunto alla lane Linux.
  Restano da consultare gli esiti hosted Linux/Windows, in particolare PowerShell, Defender e
  i comandi di decodifica Windows.
- [ ] **Packaging standalone** — Confermato il blocco: nel repository non esistono
  `Project.toml`/`src` e PackageCompiler non è installato; lo script di build richiede un
  package layout caricabile. Va completata la struttura di pacchetto prima di poter testare
  una build pulita e l'avvio senza Julia.

### Editor, strumenti e documentazione

- [x] **Integrazioni editor** — Manifest, configurazione linguaggio e grammatica VS Code
  sono JSON validi; `package.json` associa `source.triad` a `.triad` e `.td`. La validazione
  visiva dentro VS Code resta manuale.
- [ ] **Strumenti AI** — Verificati `node --check`, `julia` per `verify.jl`, `sweep --dry-run`
  e `locate --dry-run`; le soluzioni mancanti vengono dichiarate `SKIP` come documentato.
  Corretto il payload di `jev_audit.mjs`, che dichiarava 243 test e 25 casi Windows non
  verificati: ora riporta 261/261 e qualifica i risultati Windows. Restano da provare chiamate
  API (serve `TYPESAFE_API_KEY`) e verifiche `PASS` con soluzioni effettive.
- [ ] **Documentazione coerente** — Corretto il tutorial rimuovendo percorsi d'installazione
  personali e descrivendo l'ordine reale di ricerca di Julia su POSIX/Windows. Restano da
  confrontare sistematicamente tutti gli esempi e i requisiti di `README.md`, `TUTORIAL.md`,
  `SPEC.md`, `SPEC-CORE.md`, `BOOTSTRAP.md` e `STATUS.md` con comportamento e test.
- [x] **Repository e artefatti** — Verificati `.gitignore` (binari standalone, cache e
  soluzioni AI locali ignorati), hash SHA-256 dei dump seed e `git diff --check`; i generatori
  non hanno modificato golden o artefatti tracciati.

## Come registrare un nuovo bug

Per ogni problema riprodotto, aggiungere una voce con:

1. area e file coinvolti;
2. comando o passaggi minimi per riprodurlo;
3. risultato attuale e risultato atteso (riferimento alla specifica, se applicabile);
4. test aggiunto o aggiornato che impedisce la regressione.
